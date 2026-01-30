import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface SaveEditRequest {
  pageUrl: string;
  htmlContent: string;
  editedBy: string;
}

interface SaveCommentRequest {
  pageUrl: string;
  commentText: string;
  xPosition: number;
  yPosition: number;
  initials: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    const url = new URL(req.url);
    const path = url.pathname.replace("/page-editor-api", "");

    // GET /edits?pageUrl=... - Get latest edit or all edits for a page
    if (path === "/edits" && req.method === "GET") {
      const pageUrl = url.searchParams.get("pageUrl");
      const getAll = url.searchParams.get("all") === "true";

      if (!pageUrl) {
        return new Response(
          JSON.stringify({ error: "pageUrl is required" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      if (getAll) {
        // Get all edits for dashboard
        const { data, error } = await supabaseClient
          .from("page_edits")
          .select("*")
          .eq("page_url", pageUrl)
          .order("created_at", { ascending: false });

        if (error) throw error;

        return new Response(JSON.stringify(data || []), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } else {
        // Get latest edit
        const { data, error } = await supabaseClient
          .from("page_edits")
          .select("*")
          .eq("page_url", pageUrl)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) throw error;

        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // POST /edits - Save a new edit
    if (path === "/edits" && req.method === "POST") {
      const body: SaveEditRequest = await req.json();

      if (!body.pageUrl || !body.htmlContent || !body.editedBy) {
        return new Response(
          JSON.stringify({
            error: "pageUrl, htmlContent, and editedBy are required",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const { data, error } = await supabaseClient
        .from("page_edits")
        .insert({
          page_url: body.pageUrl,
          html_content: body.htmlContent,
          edited_by: body.editedBy,
        })
        .select()
        .single();

      if (error) throw error;

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /comments?pageUrl=... - Get all comments for a page
    if (path === "/comments" && req.method === "GET") {
      const pageUrl = url.searchParams.get("pageUrl");

      if (!pageUrl) {
        return new Response(
          JSON.stringify({ error: "pageUrl is required" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const { data, error } = await supabaseClient
        .from("comments")
        .select("*")
        .eq("page_url", pageUrl)
        .order("created_at", { ascending: false });

      if (error) throw error;

      return new Response(JSON.stringify(data || []), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST /comments - Save a new comment
    if (path === "/comments" && req.method === "POST") {
      const body: SaveCommentRequest = await req.json();

      if (
        !body.pageUrl ||
        !body.commentText ||
        body.xPosition === undefined ||
        body.yPosition === undefined ||
        !body.initials
      ) {
        return new Response(
          JSON.stringify({
            error:
              "pageUrl, commentText, xPosition, yPosition, and initials are required",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const { data, error } = await supabaseClient
        .from("comments")
        .insert({
          page_url: body.pageUrl,
          comment_text: body.commentText,
          x_position: body.xPosition,
          y_position: body.yPosition,
          initials: body.initials,
        })
        .select()
        .single();

      if (error) throw error;

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // DELETE /comments/:id - Delete a comment
    if (path.startsWith("/comments/") && req.method === "DELETE") {
      const commentId = path.split("/")[2];

      if (!commentId) {
        return new Response(
          JSON.stringify({ error: "comment ID is required" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const { error } = await supabaseClient
        .from("comments")
        .delete()
        .eq("id", commentId);

      if (error) throw error;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /stats?pageUrl=... - Get statistics for a page
    if (path === "/stats" && req.method === "GET") {
      const pageUrl = url.searchParams.get("pageUrl");

      if (!pageUrl) {
        return new Response(
          JSON.stringify({ error: "pageUrl is required" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Get edit count
      const { count: editCount, error: editError } = await supabaseClient
        .from("page_edits")
        .select("*", { count: "exact", head: true })
        .eq("page_url", pageUrl);

      if (editError) throw editError;

      // Get comment count
      const { count: commentCount, error: commentError } = await supabaseClient
        .from("comments")
        .select("*", { count: "exact", head: true })
        .eq("page_url", pageUrl);

      if (commentError) throw commentError;

      // Get latest edit info
      const { data: latestEdit, error: latestError } = await supabaseClient
        .from("page_edits")
        .select("edited_by, created_at")
        .eq("page_url", pageUrl)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestError) throw latestError;

      return new Response(
        JSON.stringify({
          editCount: editCount || 0,
          commentCount: commentCount || 0,
          latestEdit: latestEdit,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
