const { corsHeaders, securityHeaders } = require("../config/constants");

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...securityHeaders,
    ...corsHeaders
  });
  response.end(JSON.stringify(data));
}

function sendHtml(response, statusCode, html) {
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    ...securityHeaders,
    ...corsHeaders
  });
  response.end(html);
}

module.exports = {
  sendHtml,
  sendJson
};
