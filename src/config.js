require("dotenv").config();

module.exports = {
  ghl: {
    clientId: process.env.GHL_APP_CLIENT_ID,
    clientSecret: process.env.GHL_APP_CLIENT_SECRET,
    ssoKey: process.env.GHL_APP_SSO_KEY,
    apiDomain: process.env.GHL_API_DOMAIN || "https://services.leadconnectorhq.com",
    scopes: process.env.GHL_APP_SCOPES || "",
  },
  port: process.env.PORT || 3000,
  appUrl: process.env.APP_URL || "http://localhost:3000",
};
