// Telegram intake parsing (WF2). Pure: works on a Bot API `message` object.

/**
 * Only the owner may use the bot. Compare as strings: Telegram IDs exceed
 * what some JSON tooling treats as safe integers.
 * @param {object} message Telegram Bot API Message
 * @param {string|number} ownerChatId
 */
export function isOwner(message, ownerChatId) {
  if (!message || !message.chat || ownerChatId === undefined || ownerChatId === null) return false;
  const chatOk = String(message.chat.id) === String(ownerChatId);
  const fromOk = !message.from || String(message.from.id) === String(ownerChatId);
  return chatOk && fromOk && message.chat.type === 'private';
}

function personName(u) {
  if (!u) return null;
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ');
  return u.username ? `${name} (@${u.username})`.trim() : name || null;
}

/**
 * Describe where a forwarded message came from. Supports the Bot API
 * `forward_origin` variants: user, hidden_user, chat, channel.
 * @returns {{name: string|null, id: string|null, username: string|null, link: string|null}}
 */
export function describeOrigin(origin) {
  if (!origin) return { name: null, id: null, username: null, link: null };
  switch (origin.type) {
    case 'user':
      return {
        name: personName(origin.sender_user),
        id: origin.sender_user ? String(origin.sender_user.id) : null,
        username: origin.sender_user?.username || null,
        link: null,
      };
    case 'hidden_user':
      return { name: origin.sender_user_name || null, id: null, username: null, link: null };
    case 'chat': {
      const c = origin.sender_chat || {};
      const name = origin.author_signature ? `${c.title} (${origin.author_signature})` : c.title || null;
      return { name, id: c.id != null ? String(c.id) : null, username: c.username || null, link: null };
    }
    case 'channel': {
      const c = origin.chat || {};
      const link = c.username && origin.message_id ? `https://t.me/${c.username}/${origin.message_id}` : null;
      return { name: c.title || null, id: c.id != null ? String(c.id) : null, username: c.username || null, link };
    }
    default:
      return { name: null, id: null, username: null, link: null };
  }
}

/**
 * True when the forward's origin is on the privacy exclusion list.
 * Entries may be numeric IDs or @usernames.
 */
export function isExcludedOrigin(origin, excludeChats = []) {
  const o = describeOrigin(origin);
  const keys = [o.id, o.username && o.username.toLowerCase(), o.username && '@' + o.username.toLowerCase()].filter(Boolean);
  return (excludeChats || []).some((e) => keys.includes(String(e).toLowerCase()));
}

/**
 * Normalize a Telegram message into the fields WF2 needs.
 *
 * kind:
 *  - 'forward': a forwarded message; `text` is the original content.
 *  - 'reply':   a reply to one of the bot's confirmations (comment on an item).
 *  - 'note':    a message I typed myself; `text` is the task description.
 *
 * @param {object} message Telegram Bot API Message
 */
export function parseTelegramMessage(message) {
  const text = String(message.text || message.caption || '').trim();
  const sourceId = `tg:${message.chat.id}:${message.message_id}`;
  const origin = message.forward_origin || null;

  if (origin) {
    const o = describeOrigin(origin);
    return {
      kind: 'forward',
      text,
      sender: o.name,
      original_date: origin.date ? new Date(origin.date * 1000).toISOString() : null,
      link: o.link,
      source_id: sourceId,
      reply_to_message_id: null,
    };
  }
  if (message.reply_to_message && message.reply_to_message.from && message.reply_to_message.from.is_bot) {
    return {
      kind: 'reply',
      text,
      sender: null,
      original_date: null,
      link: null,
      source_id: sourceId,
      reply_to_message_id: message.reply_to_message.message_id,
    };
  }
  return {
    kind: 'note',
    text,
    sender: null,
    original_date: message.date ? new Date(message.date * 1000).toISOString() : null,
    link: null,
    source_id: sourceId,
    reply_to_message_id: null,
  };
}
