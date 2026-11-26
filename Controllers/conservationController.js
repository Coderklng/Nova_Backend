import redisClient from '../Config/redisClient.js';
import Conversation from '../Models/conservationModel.js';

const CACHE_TTL = 3600; // 1 hour

const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

const getRedisClient = () => {
  if (typeof redisClient?.del === 'function') return redisClient;
  if (typeof redisClient?.client?.del === 'function') return redisClient.client;
  if (typeof redisClient?.redis?.del === 'function') return redisClient.redis;
  return null;
};

const clearConversationCache = async (userId, conversationId = null) => {
  const client = getRedisClient();
  if (!client) return;

  const keys = [`conversations:user:${userId}`];
  if (conversationId) {
    keys.push(`conversation:${conversationId}`);
  }

  try {
    await client.del(keys);
  } catch (err) {
    console.warn('Redis cache clear skipped:', err.message);
  }
};

const getCached = async (key) => {
  const client = getRedisClient();
  if (!client || typeof client.get !== 'function') return null;
  try {
    return await client.get(key);
  } catch {
    return null;
  }
};

const setCached = async (key, value, ttlSec = CACHE_TTL) => {
  const client = getRedisClient();
  if (!client || typeof client.set !== 'function') return;
  try {
    await client.set(key, value, { EX: ttlSec });
  } catch {
    // Cache write failure should not break API response
  }
};

const isParticipantOrAdmin = (conversation, user) => {
  if (!conversation || !user) return false;
  if (user.role === 'admin') return true;
  const userId = user._id.toString();
  const participants = Array.isArray(conversation.participants)
    ? conversation.participants.map((p) => p.toString())
    : [];
  return participants.includes(userId);
};

export const createConversation = async (req, res) => {
  try {
    const { title, agentId, messages, metadata, isArchived, participants } = req.body;

    if (agentId && !isValidObjectId(String(agentId))) {
      return res.status(400).json({ message: 'Invalid agent ID' });
    }

    const cleanTitle =
      typeof title === 'string' && title.trim() ? title.trim() : 'New Conversation';

    const cleanMessages = Array.isArray(messages) ? messages : [];

    const memberIds = new Set([req.user._id.toString()]);
    if (Array.isArray(participants)) {
      for (const p of participants) {
        if (isValidObjectId(String(p))) {
          memberIds.add(String(p));
        }
      }
    }

    const newConversation = await Conversation.create({
      participants: Array.from(memberIds),
      agentId: agentId || null,
      title: cleanTitle,
      messages: cleanMessages,
      metadata:
        metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {},
      isArchived: typeof isArchived === 'boolean' ? isArchived : false,
    });

    await clearConversationCache(req.user._id.toString(), newConversation._id.toString());

    return res.status(201).json({
      message: 'Conversation created successfully',
      data: newConversation,
    });
  } catch (err) {
    console.error('Error in createConversation:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getMyConversations = async (req, res) => {
  const userId = req.user._id.toString();
  const cacheKey = `conversations:user:${userId}`;

  try {
    const cachedConversations = await getCached(cacheKey);
    if (cachedConversations) {
      return res.status(200).json({
        source: 'cache',
        data: JSON.parse(cachedConversations),
      });
    }

    const conversations = await Conversation.find({ participants: userId })
      .sort({ updatedAt: -1 })
      .lean();

    await setCached(cacheKey, JSON.stringify(conversations), CACHE_TTL);

    return res.status(200).json({
      source: 'database',
      data: conversations,
    });
  } catch (err) {
    console.error('Error in getMyConversations:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getConversationById = async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid conversation ID' });
  }

  const cacheKey = `conversation:${id}`;

  try {
    let conversation;
    let source = 'database';

    const cachedConversation = await getCached(cacheKey);
    if (cachedConversation) {
      conversation = JSON.parse(cachedConversation);
      source = 'cache';
    } else {
      conversation = await Conversation.findById(id).lean();
      if (!conversation) {
        return res.status(404).json({ message: 'Conversation not found' });
      }
      await setCached(cacheKey, JSON.stringify(conversation), CACHE_TTL);
    }

    if (!isParticipantOrAdmin(conversation, req.user)) {
      return res.status(403).json({ message: 'Forbidden: access denied to this conversation' });
    }

    return res.status(200).json({
      source,
      data: conversation,
    });
  } catch (err) {
    console.error('Error in getConversationById:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const updateConversation = async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid conversation ID' });
  }

  try {
    const existingConversation = await Conversation.findById(id);
    if (!existingConversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    if (!isParticipantOrAdmin(existingConversation, req.user)) {
      return res
        .status(403)
        .json({ message: "Forbidden: you cannot update another user's conversation" });
    }

    const updates = {};
    if (typeof req.body.title === 'string' && req.body.title.trim()) {
      updates.title = req.body.title.trim();
    }
    if (Array.isArray(req.body.messages)) {
      updates.messages = req.body.messages;
    }
    if (typeof req.body.isArchived === 'boolean') {
      updates.isArchived = req.body.isArchived;
    }
    if (
      req.body.metadata &&
      typeof req.body.metadata === 'object' &&
      !Array.isArray(req.body.metadata)
    ) {
      updates.metadata = req.body.metadata;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid fields provided for update' });
    }

    const updatedConversation = await Conversation.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    }).lean();

    await clearConversationCache(req.user._id.toString(), id);

    return res.status(200).json({
      message: 'Conversation updated successfully',
      data: updatedConversation,
    });
  } catch (err) {
    console.error('Error in updateConversation:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const deleteConversation = async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid conversation ID' });
  }

  try {
    const existingConversation = await Conversation.findById(id);
    if (!existingConversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    if (!isParticipantOrAdmin(existingConversation, req.user)) {
      return res
        .status(403)
        .json({ message: "Forbidden: you cannot delete another user's conversation" });
    }

    await Conversation.findByIdAndDelete(id);

    await clearConversationCache(req.user._id.toString(), id);

    return res.status(200).json({ message: 'Conversation deleted successfully' });
  } catch (err) {
    console.error('Error in deleteConversation:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};