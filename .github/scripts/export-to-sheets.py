#!/usr/bin/env python3
"""
GitHub Projects to Google Sheets Export Script

This script exports data from a GitHub project view to a Google Sheet.
It can create new tabs for each export or update an existing tab.
"""

import os
import json
import requests
import csv
import io
from datetime import datetime
from typing import Dict, List, Any, Optional
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

class GitHubProjectExporter:
    def __init__(self, github_token: str, org: str, project_number: int, view_number: int):
        self.github_token = github_token
        self.org = org
        self.project_number = project_number
        self.view_number = view_number
        self.base_url = "https://api.github.com"
        self.graphql_url = "https://api.github.com/graphql"
        self.headers = {
            "Authorization": f"Bearer {github_token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28"
        }
    
    def get_project_id(self) -> Optional[str]:
        """Get the project ID from the project number using GraphQL API"""
        query = """
        query {
          organization(login: "%s") {
            projectsV2(first: 20) {
              nodes {
                id
                number
                title
              }
            }
          }
        }
        """ % self.org
        
        response = requests.post(
            self.graphql_url,
            headers=self.headers,
            json={"query": query}
        )
        
        if response.status_code == 200:
            data = response.json()
            if 'data' in data and data['data']['organization']:
                projects = data['data']['organization']['projectsV2']['nodes']
                for project in projects:
                    if project.get('number') == self.project_number:
                        return project['id']
            else:
                print(f"GraphQL Error: {data}")
        else:
            print(f"Error fetching projects: {response.status_code} - {response.text}")
        return None
    
    def get_view_configuration(self, project_id: str) -> Dict[str, Any]:
        """Get the view configuration to determine visible fields and their order"""
        query = """
        query {
          node(id: "%s") {
            ... on ProjectV2 {
              views(first: 20) {
                nodes {
                  id
                  name
                  layout
                  fields(first: 50) {
                    nodes {
                      id
                      name
                      dataType
                      ... on ProjectV2Field {
                        name
                      }
                      ... on ProjectV2IterationField {
                        name
                      }
                      ... on ProjectV2SingleSelectField {
                        name
                        options {
                          id
                          name
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
        """ % project_id
        
        response = requests.post(
            self.graphql_url,
            headers=self.headers,
            json={"query": query}
        )
        
        if response.status_code == 200:
            data = response.json()
            if 'data' in data and data['data']['node']:
                views = data['data']['node']['views']['nodes']
                # Look for a view that might match our view number or find the first table view
                for view in views:
                    if view.get('layout') == 'TABLE_LAYOUT':
                        return view
                # If no table view found, return the first view
                if views:
                    return views[0]
        else:
            print(f"Error fetching view configuration: {response.status_code} - {response.text}")
        
        return {}
    
    def get_project_items(self, project_id: str) -> List[Dict[str, Any]]:
        """Get all items from the project using GraphQL API"""
        all_items = []
        cursor = None
        
        while True:
            query = """
            query {
              node(id: "%s") {
                ... on ProjectV2 {
                  items(first: 100%s) {
                    pageInfo {
                      hasNextPage
                      endCursor
                    }
                    nodes {
                      id
                      content {
                        ... on Issue {
                          id
                          title
                          number
                          state
                          body
                          url
                          createdAt
                          updatedAt
                          closedAt
                          parent {
                            ... on Issue {
                              id
                              title
                              number
                            }
                          }
                          labels(first: 10) {
                            nodes {
                              name
                            }
                          }
                          assignees(first: 10) {
                            nodes {
                              login
                            }
                          }
                          milestone {
                            title
                          }
                          repository {
                            name
                          }
                        }
                        ... on PullRequest {
                          id
                          title
                          number
                          state
                          body
                          url
                          createdAt
                          updatedAt
                          closedAt
                          mergedAt
                          labels(first: 10) {
                            nodes {
                              name
                            }
                          }
                          assignees(first: 10) {
                            nodes {
                              login
                            }
                          }
                          milestone {
                            title
                          }
                          repository {
                            name
                          }
                        }
                      }
                      fieldValues(first: 20) {
                        nodes {
                          __typename
                          ... on ProjectV2ItemFieldTextValue {
                            text
                            field {
                              ... on ProjectV2Field {
                                name
                              }
                            }
                          }
                          ... on ProjectV2ItemFieldNumberValue {
                            number
                            field {
                              ... on ProjectV2Field {
                                name
                              }
                            }
                          }
                          ... on ProjectV2ItemFieldDateValue {
                            date
                            field {
                              ... on ProjectV2Field {
                                name
                              }
                            }
                          }
                          ... on ProjectV2ItemFieldSingleSelectValue {
                            name
                            field {
                              ... on ProjectV2SingleSelectField {
                                name
                                options {
                                  id
                                  name
                                }
                              }
                            }
                          }
                          ... on ProjectV2ItemFieldIterationValue {
                            title
                            field {
                              ... on ProjectV2Field {
                                name
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
            """ % (project_id, f', after: "{cursor}"' if cursor else "")
            
            response = requests.post(
                self.graphql_url,
                headers=self.headers,
                json={"query": query}
            )
            
            if response.status_code == 200:
                data = response.json()
                if 'data' in data and data['data']['node']:
                    project = data['data']['node']
                    items = project['items']['nodes']
                    all_items.extend(items)
                    
                    page_info = project['items']['pageInfo']
                    if page_info['hasNextPage']:
                        cursor = page_info['endCursor']
                    else:
                        break
                else:
                    print(f"GraphQL Error: {data}")
                    break
            else:
                print(f"Error fetching project items: {response.status_code} - {response.text}")
                break
        
        return all_items
    
    def get_item_details(self, item: Dict[str, Any]) -> Dict[str, Any]:
        """Get detailed information about a project item from GraphQL response"""
        item_data = {
            'id': item.get('id'),
            'content_type': 'Unknown'
        }
        
        # Get content details based on type
        if item.get('content'):
            content = item['content']
            # Determine content type based on available fields
            if 'number' in content and 'state' in content:
                if 'mergedAt' in content:
                    item_data['content_type'] = 'PullRequest'
                else:
                    item_data['content_type'] = 'Issue'
                
                item_data.update({
                    'title': content.get('title', ''),
                    'number': content.get('number', ''),
                    'state': content.get('state', ''),
                    'body': content.get('body', ''),
                    'html_url': content.get('url', ''),
                    'parent_issue': content.get('parent', {}).get('title', '') if content.get('parent') else '',
                    'parent_issue_number': content.get('parent', {}).get('number', '') if content.get('parent') else '',
                    'parent_issue_id': content.get('parent', {}).get('id', '') if content.get('parent') else '',
                    'labels': [label['name'] for label in content.get('labels', {}).get('nodes', [])],
                    'assignees': [assignee['login'] for assignee in content.get('assignees', {}).get('nodes', [])],
                    'milestone': content.get('milestone', {}).get('title', '') if content.get('milestone') else '',
                    'created_at': content.get('createdAt', ''),
                    'updated_at': content.get('updatedAt', ''),
                    'closed_at': content.get('closedAt', ''),
                    'repository': content.get('repository', {}).get('name', '') if content.get('repository') else ''
                })
                
                if item_data['content_type'] == 'PullRequest':
                    item_data['merged_at'] = content.get('mergedAt', '')
        
        # Get project fields (custom fields) from GraphQL response
        if 'fieldValues' in item and 'nodes' in item['fieldValues']:
            field_values = {}
            for field_value in item['fieldValues']['nodes']:
                field_name = field_value.get('field', {}).get('name', 'Unknown Field')
                field_type = field_value.get('__typename', 'Unknown')
                
                # Skip fields with unknown names (likely empty or malformed field values)
                if field_name == 'Unknown Field':
                    # Debug: Print details about unknown fields
                    if len(field_values) < 5:  # Only for first few fields
                        print(f"    Skipping Unknown Field: {field_value}")
                    continue
                
                # Debug: Print field value details for first few items (uncomment for debugging)
                if len(field_values) < 5:  # Only for first few fields
                    print(f"    Field: {field_name}, Type: {field_type}, Keys: {list(field_value.keys())}")
                
                if 'text' in field_value:
                    field_values[field_name] = field_value['text']
                elif 'number' in field_value:
                    field_values[field_name] = field_value['number']
                elif 'date' in field_value:
                    field_values[field_name] = field_value['date']
                elif 'name' in field_value and 'field' in field_value:
                    # This is a single select value - the 'name' field contains the option name
                    field_values[field_name] = field_value['name']
            item_data['custom_fields'] = field_values
        
        return item_data
    
    def filter_items(self, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Filter items based on status and date conditions"""
        from datetime import datetime, timedelta
        
        filtered_items = []
        current_date = datetime.now().date()
        
        for item in items:
            # Only include sub-issues (items with a parent issue); skip parents explicitly
            if not item.get('parent_issue_id'):
                continue
            
            # Exclude sub-issues assigned to specific users
            assignees = item.get('assignees', [])
            excluded_assignees = {'halligater', 'smannan9'}
            if assignees and any(assignee.lower() in excluded_assignees for assignee in assignees):
                continue
            
            # Get status from custom fields or state
            status = ''
            if 'custom_fields' in item and 'Status' in item['custom_fields']:
                status = item['custom_fields']['Status']
            elif 'state' in item:
                status = item['state']
            
            
            # Check if status is 'In Development' or 'Completed' (case insensitive)
            # Also allow 'OPEN' and 'CLOSED' as fallback for items without custom status
            if status and status.upper() not in ['IN DEVELOPMENT', 'COMPLETED', 'OPEN', 'CLOSED']:
                continue
            
            # Get anticipated release date
            anticipated_release_date = None
            if 'custom_fields' in item and 'Anticipated release date' in item['custom_fields']:
                date_str = item['custom_fields']['Anticipated release date']
                if date_str:
                    try:
                        anticipated_release_date = datetime.strptime(date_str, '%Y-%m-%d').date()
                    except ValueError:
                        pass
            
            # Apply date filtering conditions
            date_condition_met = False
            
            # Condition 1: anticipated_release_date IS NULL
            if anticipated_release_date is None:
                date_condition_met = True
            
            # Condition 2: anticipated_release_date <= CURRENT_DATE + INTERVAL '60' DAY
            if anticipated_release_date and anticipated_release_date <= current_date + timedelta(days=60):
                date_condition_met = True
            
            # Condition 3: anticipated_release_date >= CURRENT_DATE - INTERVAL '14' DAY
            if anticipated_release_date and anticipated_release_date >= current_date - timedelta(days=14):
                date_condition_met = True
            
            if date_condition_met:
                filtered_items.append(item)
        
        return filtered_items
    
    def export_to_csv(self, items: List[Dict[str, Any]], view_config: Dict[str, Any] = None) -> str:
        """Convert items to CSV format using view configuration for field order"""
        if not items:
            return ""
        
        # Define the exact field order as requested
        preferred_field_order = [
            'Product',
            'Dev link',
            'High profile',
            'Release type',
            'Product type',
            'Anticipated release date',
            'Client organization/branch',
            'Program contacts',
            'Assignee (developer)'
        ]
        
        # Only include the exact 9 fields specified, in the exact order
        fieldnames = preferred_field_order
        
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        
        for item in items:
            row = {}
            for field in fieldnames:
                # Define possible field names for each column based on actual available fields
                possible_fields = {
                    'Product': ['Product'],
                    'Dev link': ['Dev link', 'Dev links'],
                    'High profile': ['High profile'],
                    'Release type': ['Release type'],
                    'Product type': ['Product type'],
                    'Anticipated release date': ['Anticipated release date'],
                    'Client organization/branch': ['Client organization/branch'],
                    'Program contacts': ['Client contacts'],
                    'Assignee (developer)': ['assignees']
                }
                
                # Try to find the field value using multiple possible field names
                value = None
                field_candidates = possible_fields.get(field, [field])
                
                for candidate in field_candidates:
                    # Check direct fields first
                    if candidate in item:
                        value = item[candidate]
                        break
                    # Then check custom fields
                    elif 'custom_fields' in item and candidate in item['custom_fields']:
                        value = item['custom_fields'][candidate]
                        break
                
                if value is not None:
                    if isinstance(value, list):
                        row[field] = ', '.join(str(x) for x in value)
                    else:
                        row[field] = str(value)
                else:
                    row[field] = ''
            writer.writerow(row)
        
        return output.getvalue()

class GoogleSheetsExporter:
    def __init__(self, credentials_json: str, spreadsheet_id: str):
        self.spreadsheet_id = spreadsheet_id
        self.credentials = service_account.Credentials.from_service_account_info(
            json.loads(credentials_json),
            scopes=['https://www.googleapis.com/auth/spreadsheets']
        )
        self.service = build('sheets', 'v4', credentials=self.credentials)
    
    def create_new_tab(self, tab_name: str) -> bool:
        """Create a new tab in the spreadsheet, or use existing tab if it exists"""
        try:
            # First, check if the tab already exists
            spreadsheet = self.service.spreadsheets().get(spreadsheetId=self.spreadsheet_id).execute()
            existing_sheets = [sheet['properties']['title'] for sheet in spreadsheet.get('sheets', [])]
            
            if tab_name in existing_sheets:
                print(f"Tab '{tab_name}' already exists, will replace its content")
                return True
            
            # Create new tab if it doesn't exist
            request_body = {
                'requests': [{
                    'addSheet': {
                        'properties': {
                            'title': tab_name
                        }
                    }
                }]
            }
            
            self.service.spreadsheets().batchUpdate(
                spreadsheetId=self.spreadsheet_id,
                body=request_body
            ).execute()
            print(f"Created new tab: {tab_name}")
            return True
        except HttpError as error:
            print(f"Error creating new tab: {error}")
            return False
    
    def export_csv_to_sheet(self, csv_data: str, tab_name: str, create_new_tab: bool = True) -> bool:
        """Export CSV data to a Google Sheet tab"""
        try:
            if create_new_tab:
                if not self.create_new_tab(tab_name):
                    return False
            
            # Parse CSV data
            csv_reader = csv.reader(io.StringIO(csv_data))
            values = list(csv_reader)
            
            # Clear existing data in the tab (this will work whether tab exists or not)
            range_name = f"{tab_name}!A:Z"
            try:
                self.service.spreadsheets().values().clear(
                    spreadsheetId=self.spreadsheet_id,
                    range=range_name
                ).execute()
                print(f"Cleared existing data in tab: {tab_name}")
            except HttpError as clear_error:
                print(f"Note: Could not clear existing data (tab might be empty): {clear_error}")
            
            # Write new data
            body = {'values': values}
            self.service.spreadsheets().values().update(
                spreadsheetId=self.spreadsheet_id,
                range=f"{tab_name}!A1",
                valueInputOption='RAW',
                body=body
            ).execute()
            
            print(f"Successfully exported {len(values)} rows to tab: {tab_name}")
            return True
        except HttpError as error:
            print(f"Error exporting to sheet: {error}")
            return False

def main():
    # Get environment variables
    github_token = os.getenv('PRODUCTS_TOKEN')
    github_org = os.getenv('GITHUB_ORG', 'phac-aspc')
    github_project_number = int(os.getenv('GITHUB_PROJECT_NUMBER', '1'))
    github_view_number = int(os.getenv('GITHUB_VIEW_NUMBER', '8'))
    google_sheets_id = os.getenv('GOOGLE_SHEETS_ID')
    google_credentials = os.getenv('GOOGLE_CREDENTIALS')
    create_new_tab = os.getenv('CREATE_NEW_TAB', 'true').lower() == 'true'
    
    if not all([github_token, google_sheets_id, google_credentials]):
        print("Error: Missing required environment variables")
        return
    
    # Initialize exporters
    github_exporter = GitHubProjectExporter(
        github_token, github_org, github_project_number, github_view_number
    )
    sheets_exporter = GoogleSheetsExporter(google_credentials, google_sheets_id)
    
    # Get project ID
    print(f"Getting project ID for project #{github_project_number}...")
    project_id = github_exporter.get_project_id()
    if not project_id:
        print("Error: Could not find project ID")
        return
    
    print(f"Found project ID: {project_id}")
    
    # Get view configuration to determine field order
    print("Getting view configuration...")
    view_config = github_exporter.get_view_configuration(project_id)
    if view_config:
        print(f"Found view: {view_config.get('name', 'Unknown')} (Layout: {view_config.get('layout', 'Unknown')})")
        if 'fields' in view_config and 'nodes' in view_config['fields']:
            field_names = [field.get('name', '') for field in view_config['fields']['nodes']]
            print(f"View fields: {', '.join(field_names)}")
    else:
        print("No view configuration found, using default field order")
    
    # Get project items
    print("Fetching project items...")
    items = github_exporter.get_project_items(project_id)
    print(f"Found {len(items)} items")
    
    if not items:
        print("No items found in project")
        return
    
    # Get detailed information for each item
    print("Getting detailed information for items...")
    detailed_items = []
    for i, item in enumerate(items):
        print(f"Processing item {i+1}/{len(items)}")
        detailed_item = github_exporter.get_item_details(item)
        
        # Debug: Print custom fields for first few items (uncomment for debugging)
        # if 'custom_fields' in detailed_item:
        print(f"  Custom fields for item {i+1}: {detailed_item['custom_fields']}")
        
        detailed_items.append(detailed_item)
    
    
    # Apply filtering based on status and date conditions
    print("Applying filtering conditions...")
    
    # Count sub-issues before filtering
    sub_issues_count = sum(1 for item in detailed_items if item.get('parent_issue_id'))
    print(f"Found {sub_issues_count} sub-issues out of {len(detailed_items)} total items")
    
    filtered_items = github_exporter.filter_items(detailed_items)
    print(f"After filtering: {len(filtered_items)} items (from {len(detailed_items)} total)")
    
    # Convert to CSV using view configuration
    print("Converting to CSV format...")
    csv_data = github_exporter.export_to_csv(filtered_items, view_config)
    
    # Create tab name with timestamp
    timestamp = datetime.now().strftime("%Y-%m-%d")
    tab_name = f"Export_{timestamp}"
    
    # Export to Google Sheets
    print(f"Exporting to Google Sheets tab: {tab_name}")
    success = sheets_exporter.export_csv_to_sheet(csv_data, tab_name, create_new_tab)
    
    if success:
        print("Export completed successfully!")
    else:
        print("Export failed!")

if __name__ == "__main__":
    main()
