const axios = require("axios");
const CryptoJS = require("crypto-js");
const config = require("../config");
const store = require("./store");

const TOKEN_URL = `${config.ghl.apiDomain}/oauth/token`;
const REDIRECT_URI = `${config.appUrl}/oauth/callback`;

async function exchangeCodeForTokens(code) {
  const params = new URLSearchParams({
    client_id: config.ghl.clientId,
    client_secret: config.ghl.clientSecret,
    grant_type: "authorization_code",
    code,
    user_type: "Location",
    redirect_uri: REDIRECT_URI,
  });

  const { data } = await axios.post(TOKEN_URL, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  await store.saveTokens(data.locationId, data);
  console.log(`Tokens stored for location ${data.locationId}`);
  return data;
}

async function refreshAccessToken(locationId) {
  const existing = await store.getTokens(locationId);
  if (!existing) throw new Error(`No tokens found for location ${locationId}`);

  const params = new URLSearchParams({
    client_id: config.ghl.clientId,
    client_secret: config.ghl.clientSecret,
    grant_type: "refresh_token",
    refresh_token: existing.refresh_token,
    user_type: "Location",
    redirect_uri: REDIRECT_URI,
  });

  const { data } = await axios.post(TOKEN_URL, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  // Refresh tokens are single-use — always merge and persist the new one
  await store.saveTokens(locationId, { ...existing, ...data });
  console.log(`Tokens refreshed for location ${locationId}`);
  return data.access_token;
}

/**
 * Make an authenticated GHL API call with automatic token refresh on 401.
 * Use this for any API call to GHL services.
 */
async function apiCall(locationId, method, url, data = null) {
  const tokens = await store.getTokens(locationId);
  if (!tokens) throw new Error(`No tokens for location ${locationId}`);

  const headers = {
    Authorization: `Bearer ${tokens.access_token}`,
    "Content-Type": "application/json",
    Version: "2021-07-28",
  };

  const opts = { method, url, headers };
  if (data) opts.data = data;

  try {
    return await axios(opts);
  } catch (err) {
    if (err.response?.status === 401) {
      console.log(`Token expired for ${locationId}, refreshing...`);
      const newToken = await refreshAccessToken(locationId);
      opts.headers.Authorization = `Bearer ${newToken}`;
      return await axios(opts);
    }
    throw err;
  }
}

function decryptSSOData(key) {
  const decrypted = CryptoJS.AES.decrypt(key, config.ghl.ssoKey).toString(
    CryptoJS.enc.Utf8
  );
  return JSON.parse(decrypted);
}

module.exports = {
  exchangeCodeForTokens,
  refreshAccessToken,
  apiCall,
  decryptSSOData,
};
