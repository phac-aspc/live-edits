import { PageData, AppStatus } from './types';

// Note: StorageService initializes with 'proj_demo' wrapping these.
// We leave the structure compatible here.
export const INITIAL_PAGES: PageData[] = [
  {
    id: 'p1',
    projectId: 'proj_demo', // Placeholder
    fileName: 'index.html',
    originalHtml: '', // Placeholder, filled by StorageService init
    slug: 'home',
    title: 'Welcome to Health Infobase',
    lastUpdated: Date.now(),
    blocks: [
      { id: 'b1', type: 'h1', content: 'Welcome to Health Infobase', originalIndex: 0 },
      { id: 'b2', type: 'p', content: 'Your trusted source for public health information, guidelines, and updates. We are dedicated to providing accurate and timely data to the community.', originalIndex: 1 },
      { id: 'b3', type: 'h2', content: 'Latest Alerts', originalIndex: 2 },
      { id: 'b4', type: 'warning', content: 'Flu season is approaching. Please schedule your vaccination at your nearest clinic.', originalIndex: 3 },
      { id: 'b5', type: 'p', content: 'Navigate through the sidebar to find specific health topics ranging from nutrition to disease prevention.', originalIndex: 4 }
    ]
  },
  {
    id: 'p2',
    projectId: 'proj_demo',
    fileName: 'nutrition.html',
    originalHtml: '',
    slug: 'nutrition',
    title: 'Nutrition & Wellness',
    lastUpdated: Date.now() - 86400000,
    blocks: [
      { id: 'b2-1', type: 'h1', content: 'Nutrition & Wellness Guidelines', originalIndex: 0 },
      { id: 'b2-2', type: 'p', content: 'A balanced diet is crucial for maintaining a healthy immune system. Focus on whole foods, including plenty of fruits and vegetables.', originalIndex: 1 },
      { id: 'b2-3', type: 'h2', content: 'Hydration', originalIndex: 2 },
      { id: 'b2-4', type: 'p', content: 'Drinking water is essential. Aim for at least 8 glasses a day, more if you are active.', originalIndex: 3 }
    ]
  },
  {
    id: 'p3',
    projectId: 'proj_demo',
    fileName: 'vaccines.html',
    originalHtml: '',
    slug: 'vaccines',
    title: 'Vaccination Information',
    lastUpdated: Date.now() - 172800000,
    blocks: [
      { id: 'b3-1', type: 'h1', content: 'Vaccination Schedules', originalIndex: 0 },
      { id: 'b3-2', type: 'p', content: 'Vaccines are safe and effective. Consult the table below for the recommended schedule for children and adults.', originalIndex: 1 },
      { id: 'b3-3', type: 'warning', content: 'New booster shots are available for eligible age groups.', originalIndex: 2 }
    ]
  }
];

export const MOCK_STATUS: AppStatus = {
  status: 'RUNNING',
  version: '2.1.0-projects',
  uptime: 342000, // seconds
  activeUsers: 12
};