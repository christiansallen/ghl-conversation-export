const config = require("../config");
const ghl = require("./ghl");

const API = config.ghl.apiDomain;
const DELAY_MS = 80;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch all conversations for a contact (paginated).
 */
async function fetchAllConversations(locationId, contactId, onProgress) {
  const conversations = [];
  let lastMessageId = undefined;

  while (true) {
    const params = new URLSearchParams({
      locationId,
      contactId,
    });
    if (lastMessageId) params.set("lastMessageId", lastMessageId);

    const { data } = await ghl.apiCall(
      locationId,
      "GET",
      `${API}/conversations/search?${params}`
    );

    const batch = Array.isArray(data.conversations) ? data.conversations : [];
    if (!Array.isArray(data.conversations)) {
      console.log("Conversations response shape:", Object.keys(data || {}));
    }
    conversations.push(...batch);

    if (onProgress) {
      onProgress({ phase: "conversations", count: conversations.length });
    }

    // GHL returns empty array or fewer results when no more pages
    if (batch.length === 0) break;

    // Pagination: try different fields GHL might use
    const nextId = data.lastMessageId || batch[batch.length - 1]?.lastMessageId || batch[batch.length - 1]?.id;
    if (!nextId || nextId === lastMessageId) break;
    lastMessageId = nextId;

    await delay(DELAY_MS);
  }

  return conversations;
}

/**
 * Fetch all messages for a conversation (paginated, newest first from API).
 */
async function fetchAllMessages(locationId, conversationId, onProgress) {
  const messages = [];
  let lastMessageId = undefined;

  while (true) {
    const params = new URLSearchParams();
    if (lastMessageId) params.set("lastMessageId", lastMessageId);

    const url = `${API}/conversations/${conversationId}/messages${params.toString() ? "?" + params : ""}`;
    const { data } = await ghl.apiCall(locationId, "GET", url);

    const batch = Array.isArray(data.messages)
      ? data.messages
      : data.messages?.messages
        ? data.messages.messages
        : [];
    if (!Array.isArray(data.messages)) {
      console.log("Messages response shape:", JSON.stringify(data).slice(0, 500));
    }
    messages.push(...batch);

    if (onProgress) {
      onProgress({
        phase: "messages",
        conversationId,
        count: messages.length,
      });
    }

    if (batch.length === 0) break;

    const nextId = data.lastMessageId || batch[batch.length - 1]?.id;
    if (!nextId || nextId === lastMessageId) break;
    lastMessageId = nextId;

    await delay(DELAY_MS);
  }

  return messages;
}

/**
 * Fetch call transcription for a message.
 */
async function fetchTranscription(locationId, messageId) {
  try {
    const { data } = await ghl.apiCall(
      locationId,
      "GET",
      `${API}/conversations/messages/${messageId}/locations/${locationId}/recording`
    );
    return data.transcription || null;
  } catch (err) {
    // Transcription may not exist for all calls
    if (err.response?.status === 404 || err.response?.status === 422) {
      return null;
    }
    throw err;
  }
}

/**
 * Fetch complete conversation history for a contact.
 * Returns all messages sorted chronologically (oldest first).
 */
async function fetchContactHistory(locationId, contactId, onProgress) {
  // 1. Get all conversations
  const conversations = await fetchAllConversations(
    locationId,
    contactId,
    onProgress
  );

  if (onProgress) {
    onProgress({
      phase: "fetching_messages",
      totalConversations: conversations.length,
      completedConversations: 0,
    });
  }

  // 2. Get all messages from each conversation
  const allMessages = [];
  for (let i = 0; i < conversations.length; i++) {
    const conv = conversations[i];
    const messages = await fetchAllMessages(locationId, conv.id, onProgress);
    allMessages.push(...messages);

    if (onProgress) {
      onProgress({
        phase: "fetching_messages",
        totalConversations: conversations.length,
        completedConversations: i + 1,
        totalMessages: allMessages.length,
      });
    }

    await delay(DELAY_MS);
  }

  // 3. Fetch transcriptions for completed calls
  const callMessages = allMessages.filter(
    (m) =>
      m.messageType === "CALL" &&
      m.status === "completed" &&
      m.direction
  );

  for (let i = 0; i < callMessages.length; i++) {
    const msg = callMessages[i];
    const transcription = await fetchTranscription(locationId, msg.id);
    if (transcription) {
      msg.transcription = transcription;
    }

    if (onProgress) {
      onProgress({
        phase: "transcriptions",
        total: callMessages.length,
        completed: i + 1,
      });
    }

    await delay(DELAY_MS);
  }

  // 4. Sort chronologically (oldest first)
  allMessages.sort(
    (a, b) => new Date(a.dateAdded) - new Date(b.dateAdded)
  );

  return allMessages;
}

module.exports = {
  fetchAllConversations,
  fetchAllMessages,
  fetchTranscription,
  fetchContactHistory,
};
