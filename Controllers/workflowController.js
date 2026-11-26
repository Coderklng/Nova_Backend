import redisClient from '../Config/redisClient.js';
import Workflow from '../Models/workflowModel.js';

const CACHE_TTL = 3600; // 1 hour

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

const normalizeTrigger = (trigger) => {
  if (typeof trigger === 'object' && trigger !== null) {
    return {
      eventType: String(trigger.eventType || 'manual').trim() || 'manual',
      conditions:
        typeof trigger.conditions === 'object' && trigger.conditions !== null
          ? trigger.conditions
          : {},
    };
  }
  return {
    eventType: typeof trigger === 'string' && trigger.trim() ? trigger.trim() : 'manual',
    conditions: {},
  };
};

// Naya Workflow create karne ke liye
export const createWorkflow = async (req, res) => {
  try {
    const rawUserId = getUserIdFromReq(req);
    if (!rawUserId) {
      return res.status(401).json({ message: 'Unauthorized: user ID missing' });
    }

    const { title, name, trigger, actions, steps, isEnabled } = req.body;

    const resolvedTitle = String(title || name || '').trim();
    if (!resolvedTitle) {
      return res.status(400).json({ message: 'Workflow title is required' });
    }

    const ownerId = rawUserId.toString();
    const rawActions = Array.isArray(actions) ? actions : Array.isArray(steps) ? steps : [];

    const newWorkflow = await Workflow.create({
      title: resolvedTitle,
      ownerId,
      trigger: normalizeTrigger(trigger),
      actions: rawActions,
      isEnabled: typeof isEnabled === 'boolean' ? isEnabled : true,
    });

    await safeCacheDel(`workflows:user:${ownerId}`);

    return res.status(201).json({
      message: 'Workflow created successfully',
      data: newWorkflow,
    });
  } catch (err) {
    if (err.name === 'ValidationError') {
      return res.status(400).json({ message: err.message });
    }
    console.error('Error in createWorkflow:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Logged-in user ke saare workflows fetch karne ke liye
export const getMyWorkflows = async (req, res) => {
  const rawUserId = getUserIdFromReq(req);
  if (!rawUserId) {
    return res.status(401).json({ message: 'Unauthorized: user ID missing' });
  }

  const userId = rawUserId.toString();
  const cacheKey = `workflows:user:${userId}`;

  try {
    const cachedWorkflows = await safeCacheGet(cacheKey);
    if (cachedWorkflows) {
      return res.status(200).json({
        source: 'cache',
        data: JSON.parse(cachedWorkflows),
      });
    }

    const workflows = await Workflow.find({ ownerId: userId })
      .sort({ createdAt: -1 })
      .lean();
    await safeCacheSet(cacheKey, JSON.stringify(workflows));

    return res.status(200).json({
      source: 'database',
      data: workflows,
    });
  } catch (err) {
    console.error('Error in getMyWorkflows:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ID se ek single workflow fetch karne ke liye
export const getWorkflowById = async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid workflow ID' });
  }

  const rawUserId = getUserIdFromReq(req);
  if (!rawUserId) {
    return res.status(401).json({ message: 'Unauthorized: user ID missing' });
  }

  const cacheKey = `workflow:${id}`;

  try {
    let workflow;
    let source = 'database';

    const cachedWorkflow = await safeCacheGet(cacheKey);
    if (cachedWorkflow) {
      workflow = JSON.parse(cachedWorkflow);
      source = 'cache';
    } else {
      workflow = await Workflow.findById(id).lean();
      if (!workflow) {
        return res.status(404).json({ message: 'Workflow not found' });
      }
      await safeCacheSet(cacheKey, JSON.stringify(workflow));
    }

    const ownerId = workflow.ownerId?.toString();
    if (ownerId !== rawUserId.toString() && req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden: access denied to this workflow' });
    }

    return res.status(200).json({
      source,
      data: workflow,
    });
  } catch (err) {
    console.error('Error in getWorkflowById:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Workflow update karne ke liye
export const updateWorkflow = async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid workflow ID' });
  }

  const rawUserId = getUserIdFromReq(req);
  if (!rawUserId) {
    return res.status(401).json({ message: 'Unauthorized: user ID missing' });
  }

  try {
    const existingWorkflow = await Workflow.findById(id);
    if (!existingWorkflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    const ownerId = existingWorkflow.ownerId?.toString();
    if (ownerId !== rawUserId.toString() && req.user?.role !== 'admin') {
      return res
        .status(403)
        .json({ message: "Forbidden: you cannot update another user's workflow" });
    }

    const updates = {};
    if (typeof req.body.title === 'string' && req.body.title.trim()) {
      updates.title = req.body.title.trim();
    } else if (typeof req.body.name === 'string' && req.body.name.trim()) {
      updates.title = req.body.name.trim();
    }

    if (req.body.trigger !== undefined) {
      updates.trigger = normalizeTrigger(req.body.trigger);
    }

    if (Array.isArray(req.body.actions)) {
      updates.actions = req.body.actions;
    } else if (Array.isArray(req.body.steps)) {
      updates.actions = req.body.steps;
    }

    if (typeof req.body.isEnabled === 'boolean') {
      updates.isEnabled = req.body.isEnabled;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid fields provided for update' });
    }

    const updatedWorkflow = await Workflow.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    }).lean();

    await safeCacheDel([`workflow:${id}`, `workflows:user:${ownerId}`]);

    return res.status(200).json({
      message: 'Workflow updated successfully',
      data: updatedWorkflow,
    });
  } catch (err) {
    if (err.name === 'ValidationError') {
      return res.status(400).json({ message: err.message });
    }
    console.error('Error in updateWorkflow:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Workflow delete karne ke liye
export const deleteWorkflow = async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid workflow ID' });
  }

  const rawUserId = getUserIdFromReq(req);
  if (!rawUserId) {
    return res.status(401).json({ message: 'Unauthorized: user ID missing' });
  }

  try {
    const existingWorkflow = await Workflow.findById(id);
    if (!existingWorkflow) {
      return res.status(404).json({ message: 'Workflow not found' });
    }

    const ownerId = existingWorkflow.ownerId?.toString();
    if (ownerId !== rawUserId.toString() && req.user?.role !== 'admin') {
      return res
        .status(403)
        .json({ message: "Forbidden: you cannot delete another user's workflow" });
    }

    await Workflow.findByIdAndDelete(id);

    await safeCacheDel([`workflow:${id}`, `workflows:user:${ownerId}`]);

    return res.status(200).json({ message: 'Workflow deleted successfully' });
  } catch (err) {
    console.error('Error in deleteWorkflow:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};