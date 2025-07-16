// worker.js - Cloudflare Worker Proxy for Mistral AI

// The Mistral API Key will be set as a secret in Cloudflare Workers environment variables.
// It is accessed via `env.MISTRAL_API_KEY`.
const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";
const MODEL_NAME = "mistral-tiny"; // The Mistral model you want to use

// Allowed origins for CORS and referrer checks.
// IMPORTANT: Customize this array with your actual domains.
const ALLOWED_DOMAINS = [
    "jeremyworld.org",
    "www.jeremyworld.org",
    "jerrymarkone.jeremyworld.org"
    // Add any other specific subdomains if needed, e.g.:
    // "dev.jeremyworld.org",
    // If you are testing directly on GitHub Pages before setting up a custom domain,
    // you might need to add your GitHub Pages URL here temporarily, e.g.:
    // "your-github-username.github.io",
    // "your-github-username.github.io/your-repo-name"
];

// Helper function to check if a hostname is allowed
function isAllowedHostname(hostname) {
    return ALLOWED_DOMAINS.some(domain => {
        // Check for exact match or subdomain match
        // Ensure to handle cases like "www.jeremyworld.org" and "jeremyworld.org"
        return hostname === domain || hostname.endsWith(`.${domain}`);
    });
}

// Main event listener for incoming requests to the Worker
addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
    // Initialize CORS headers. Access-Control-Allow-Origin will be dynamically set.
    let corsHeaders = {
        'Access-Control-Allow-Origin': '*', // Default, will be updated based on allowed domains
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400', // Cache preflight for 24 hours
    };

    // Handle preflight OPTIONS request (sent by browsers for CORS)
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204, // No Content
            headers: corsHeaders,
        });
    }

    // --- Security Check: Verify Origin and Referer headers ---
    const originHeader = request.headers.get('Origin');
    const refererHeader = request.headers.get('Referer'); // Note: Referer header might not always be present or reliable

    let allowedRequest = false;
    let responseOrigin = '*'; // Default response origin for ACAO header

    // Check Origin header first (most reliable for CORS)
    if (originHeader) {
        try {
            const originHostname = new URL(originHeader).hostname;
            if (isAllowedHostname(originHostname)) {
                allowedRequest = true;
                responseOrigin = originHeader; // Echo back the specific allowed origin
            }
        } catch (e) {
            // Invalid Origin URL, treat as not allowed
            console.warn(`Invalid Origin URL: ${originHeader}`);
        }
    }

    // If Origin is not allowed or not present, check Referer as a fallback
    // This helps with direct page loads where Origin might be null/omitted, but Referer is present.
    if (!allowedRequest && refererHeader) {
        try {
            const refererHostname = new URL(refererHeader).hostname;
            if (isAllowedHostname(refererHostname)) {
                allowedRequest = true;
                // If allowed by referer, we'll allow the request.
                // The `responseOrigin` will remain '*' or the last valid origin found (if any).
                // For stricter control, you might want to force `responseOrigin` to a specific allowed domain here.
            }
        } catch (e) {
            // Invalid Referer URL, treat as not allowed
            console.warn(`Invalid Referer URL: ${refererHeader}`);
        }
    }

    // Update CORS Access-Control-Allow-Origin header based on validation
    corsHeaders['Access-Control-Allow-Origin'] = responseOrigin;

    // If the request is not from an allowed domain, return 403 Forbidden
    if (!allowedRequest) {
        console.warn(`Unauthorized request blocked. Origin: ${originHeader}, Referer: ${refererHeader}`);
        return new Response(JSON.stringify({ error: 'Forbidden: Access denied from this origin/referrer.' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
    }

    // --- API Key Check and Proxying ---

    // Access the Mistral API Key from the Worker's environment variables (secrets)
    // 'env' object is automatically provided by Cloudflare Workers runtime
    const MISTRAL_API_KEY = env.MISTRAL_API_KEY; 
    if (!MISTRAL_API_KEY) {
        console.error("MISTRAL_API_KEY environment variable is not set in Cloudflare Worker.");
        return new Response(JSON.stringify({ error: 'Server configuration error: API key missing.' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
    }

    try {
        // Ensure the request method is POST for the actual API call
        if (request.method !== 'POST') {
            return new Response(JSON.stringify({ error: 'Method Not Allowed. Only POST requests are supported for this proxy.' }), {
                status: 405,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
        }

        // Parse the incoming request body from your frontend
        const requestBody = await request.json();

        // Ensure the model name is set in the request body for Mistral AI
        requestBody.model = MODEL_NAME;

        // Forward the request to the actual Mistral AI API
        const mistralResponse = await fetch(MISTRAL_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${MISTRAL_API_KEY}` // Use the securely stored API key
            },
            body: JSON.stringify(requestBody)
        });

        const responseData = await mistralResponse.json();

        // If Mistral AI returned an error, propagate it back to the frontend
        if (!mistralResponse.ok) {
            console.error("Mistral API error response:", responseData);
            return new Response(JSON.stringify({ error: `Mistral API Error: ${responseData.message || mistralResponse.statusText}` }), {
                status: mistralResponse.status,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
        }

        // If successful, send the Mistral AI response back to the frontend
        return new Response(JSON.stringify(responseData), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });

    } catch (error) {
        // Catch any errors during parsing or fetching
        console.error('Cloudflare Worker caught an error:', error);
        return new Response(JSON.stringify({ error: 'Internal server error processing request.' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
    }
}

