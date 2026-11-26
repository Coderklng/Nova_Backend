import redisClient from '../Config/redisClient.js';
import Agent from '../Models/agentModel.js';
import Workspace from '../Models/workflowModel.js';

const CACHE_TTL = 3600; // 1 hour
const ALLOWED_ROLES = ['coder', 'researcher', 'voice_bot', 'automator'];

const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

const getUserIdFromReq = (req) => req.user?._id || req.user?.id || req.user?.userId;

const canUseRedis = () =>
  Boolean(redisClient) &&
  typeof redisClient.get === 'function' &&
  typeof redisClient.set === 'function' &&
  (redisClient.isOpen === undefined || redisClient.isOpen === true);

const safeCacheGet = async (key) => {
  if (!canUseRedis()) return null;
  try {
    return await redisClient.get(key);
  } catch (err) {
    console.warn('Redis GET skipped:', err.message);
    return null;
  }
};

const safeCacheSet = async (key, value, ttlSeconds = CACHE_TTL) => {
  if (!canUseRedis()) return;
  try {
    await redisClient.set(key, value, { EX: ttlSeconds });
  } catch (err) {
    console.warn('Redis SET skipped:', err.message);
  }
};

const safeCacheDel = async (keys) => {
  if (!canUseRedis() || typeof redisClient.del !== 'function') return;
  try {
    const list = Array.isArray(keys) ? keys : [keys];
    await redisClient.del(list);
  } catch (err) {
    console.warn('Redis DEL skipped:', err.message);
  }
};

const normalizeConfig = (rawConfig = {}, body = {}) => {
  const src = typeof rawConfig === 'object' && rawConfig !== null ? rawConfig : {};
  const llmModel = String(src.llmModel || body.llmModel || body.model || 'NovaAi').trim();
  const tempVal = src.temperature ?? body.temperature ?? 0.7;
  const maxTokensVal = src.maxTokens ?? body.maxTokens ?? 512;

  return {
    llmModel: llmModel || 'NovaAi',
    temperature: Number.isFinite(Number(tempVal)) ? Number(tempVal) : 0.7,
    maxTokens: Number.isFinite(Number(maxTokensVal)) ? Number(maxTokensVal) : 512,
  };
};

// Naya Agent create karne ke liye
export const createAgent = async (req, res) => {
  try {
    const rawUserId = getUserIdFromReq(req);
    if (!rawUserId) {
      return res.status(401).json({ message: 'Unauthorized: user ID missing' });
    }

    const { name, role, configuration, systemPrompt, workspaceId, isActive } = req.body;

    const cleanName = typeof name === 'string' ? name.trim() : '';
    const cleanPrompt = typeof systemPrompt === 'string' ? systemPrompt.trim() : '';

    if (!cleanName || !cleanPrompt) {
      return res.status(400).json({ message: 'Valid name and systemPrompt are required' });
    }

    const cleanRole = typeof role === 'string' ? role.trim() : '';
    if (!ALLOWED_ROLES.includes(cleanRole)) {
      return res.status(400).json({
        message: `Role must be one of: ${ALLOWED_ROLES.join(', ')}`,
      });
    }

    const ownerId = rawUserId.toString();

    let resolvedWorkspaceId =
      workspaceId || req.workspace?._id || req.headers['x-workspace-id'];

    if (!resolvedWorkspaceId && Agent.schema.path('workspaceId')?.isRequired) {
      let ws = await Workspace.findOne({ ownerId }).lean();
      if (!ws) {
        ws = await Workspace.create({ name: 'Default Workspace', ownerId });
      }
      resolvedWorkspaceId = ws._id;
    }

    const payload = {
      name: cleanName,
      role: cleanRole,
      configuration: normalizeConfig(configuration, req.body),
      systemPrompt: cleanPrompt,
      ownerId,
      isActive: typeof isActive === 'boolean' ? isActive : true,
    };

    if (resolvedWorkspaceId) {
      if (!isValidObjectId(String(resolvedWorkspaceId))) {
        return res.status(400).json({ message: 'Invalid workspaceId format' });
      }
      payload.workspaceId = String(resolvedWorkspaceId);
    }

    const newAgent = await Agent.create(payload);

    await safeCacheDel(`agents:user:${ownerId}`);

    return res.status(201).json({
      message: 'Agent created successfully',
      data: newAgent,
    });
  } catch (err) {
    if (err.name === 'ValidationError') {
      return res.status(400).json({ message: err.message });
    }
    console.error('Error in createAgent:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Logged-in user ke saare agents fetch karne ke liye
export const getMyAgents = async (req, res) => {
  const rawUserId = getUserIdFromReq(req);
  if (!rawUserId) {
    return res.status(401).json({ message: 'Unauthorized: user ID missing' });
  }

  const userId = rawUserId.toString();
  const cacheKey = `agents:user:${userId}`;

  try {
    const cachedAgents = await safeCacheGet(cacheKey);
    if (cachedAgents) {
      return res.status(200).json({
        source: 'cache',
        data: JSON.parse(cachedAgents),
      });
    }

    const agents = await Agent.find({ ownerId: userId }).sort({ createdAt: -1 }).lean();
    await safeCacheSet(cacheKey, JSON.stringify(agents));

    return res.status(200).json({
      source: 'database',
      data: agents,
    });
  } catch (err) {
    console.error('Error in getMyAgents:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ID se ek single agent fetch karne ke liye
export const getAgentById = async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid agent ID' });
  }

  const rawUserId = getUserIdFromReq(req);
  if (!rawUserId) {
    return res.status(401).json({ message: 'Unauthorized: user ID missing' });
  }

  const cacheKey = `agent:${id}`;

  try {
    let agent;
    let source = 'database';

    const cachedAgent = await safeCacheGet(cacheKey);
    if (cachedAgent) {
      agent = JSON.parse(cachedAgent);
      source = 'cache';
    } else {
      agent = await Agent.findById(id).lean();
      if (!agent) {
        return res.status(404).json({ message: 'Agent not found' });
      }
      await safeCacheSet(cacheKey, JSON.stringify(agent));
    }

    const ownerId = agent.ownerId?.toString();
    if (ownerId !== rawUserId.toString() && req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden: access denied to this agent' });
    }

    return res.status(200).json({
      source,
      data: agent,
    });
  } catch (err) {
    console.error('Error in getAgentById:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Agent update karne ke liye
export const updateAgent = async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid agent ID' });
  }

  const rawUserId = getUserIdFromReq(req);
  if (!rawUserId) {
    return res.status(401).json({ message: 'Unauthorized: user ID missing' });
  }

  try {
    const existingAgent = await Agent.findById(id);
    if (!existingAgent) {
      return res.status(404).json({ message: 'Agent not found' });
    }

    const ownerId = existingAgent.ownerId?.toString();
    if (ownerId !== rawUserId.toString() && req.user?.role !== 'admin') {
      return res
        .status(403)
        .json({ message: "Forbidden: you cannot update another user's agent" });
    }

    const updates = {};
    if (typeof req.body.name === 'string' && req.body.name.trim()) {
      updates.name = req.body.name.trim();
    }
    if (typeof req.body.role === 'string' && req.body.role.trim()) {
      if (!ALLOWED_ROLES.includes(req.body.role.trim())) {
        return res.status(400).json({
          message: `Role must be one of: ${ALLOWED_ROLES.join(', ')}`,
        });
      }
      updates.role = req.body.role.trim();
    }
    if (typeof req.body.systemPrompt === 'string' && req.body.systemPrompt.trim()) {
      updates.systemPrompt = req.body.systemPrompt.trim();
    }
    if (
      req.body.configuration ||
      req.body.llmModel !== undefined ||
      req.body.temperature !== undefined ||
      req.body.maxTokens !== undefined
    ) {
      const mergedBase = {
        llmModel: existingAgent.configuration?.llmModel || 'NovaAi',
        temperature: existingAgent.configuration?.temperature ?? 0.7,
        maxTokens: existingAgent.configuration?.maxTokens ?? 512,
        ...(req.body.configuration || {}),
      };
      updates.configuration = normalizeConfig(mergedBase, req.body);
    }
    if (typeof req.body.isActive === 'boolean') {
      updates.isActive = req.body.isActive;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid fields provided for update' });
    }

    const updatedAgent = await Agent.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    }).lean();

    await safeCacheDel([`agent:${id}`, `agents:user:${ownerId}`]);

    return res.status(200).json({
      message: 'Agent updated successfully',
      data: updatedAgent,
    });
  } catch (err) {
    if (err.name === 'ValidationError') {
      return res.status(400).json({ message: err.message });
    }
    console.error('Error in updateAgent:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Agent delete karne ke liye
export const deleteAgent = async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid agent ID' });
  }

  const rawUserId = getUserIdFromReq(req);
  if (!rawUserId) {
    return res.status(401).json({ message: 'Unauthorized: user ID missing' });
  }

  try {
    const existingAgent = await Agent.findById(id);
    if (!existingAgent) {
      return res.status(404).json({ message: 'Agent not found' });
    }

    const ownerId = existingAgent.ownerId?.toString();
    if (ownerId !== rawUserId.toString() && req.user?.role !== 'admin') {
      return res
        .status(403)
        .json({ message: "Forbidden: you cannot delete another user's agent" });
    }

    await Agent.findByIdAndDelete(id);

    await safeCacheDel([`agent:${id}`, `agents:user:${ownerId}`]);

    return res.status(200).json({ message: 'Agent deleted successfully' });
  } catch (err) {
    console.error('Error in deleteAgent:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};