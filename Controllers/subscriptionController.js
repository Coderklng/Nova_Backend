import redisClient from '../Config/redisClient.js';
import Subscription from '../Models/subscriptionModel.js';

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

const clearUserSubscriptionCache = async (userId, subscriptionId = null) => {
  if (!canUseRedis() || typeof redisClient.del !== 'function') return;
  try {
    const keys = [`subscription:user:${userId}`, `subscriptions:user:${userId}`];
    if (subscriptionId) {
      keys.push(`subscription:${subscriptionId}`);
    }
    await redisClient.del(keys);
  } catch (err) {
    console.warn('Redis DEL skipped:', err.message);
  }
};

// Naya Subscription create karne ke liye
export const createSubscription = async (req, res, next) => {
  try {
    const rawUserId = getUserIdFromReq(req);
    if (!rawUserId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: user ID missing from token/session',
      });
    }

    const userId = rawUserId.toString();
    const {
      plan,
      status,
      currentPeriodStart,
      currentPeriodEnd,
      usageLimits,
      stripeSubscriptionId,
    } = req.body;

    const existing = await Subscription.findOne({ userId });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Subscription already exists for this user',
      });
    }

    const resolvedPeriodEnd =
      currentPeriodEnd || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const subscription = await Subscription.create({
      userId,
      plan: plan || 'free',
      status: status || 'active',
      currentPeriodStart: currentPeriodStart || new Date(),
      currentPeriodEnd: resolvedPeriodEnd,
      usageLimits,
      stripeSubscriptionId,
    });

    await clearUserSubscriptionCache(userId, subscription._id.toString());

    return res.status(201).json({
      success: true,
      data: subscription,
    });
  } catch (error) {
    console.error('Error in createSubscription:', error);
    return next(error);
  }
};

// Logged-in user ka current / latest subscription fetch karne ke liye
export const getMySubscription = async (req, res) => {
  const rawUserId = getUserIdFromReq(req);
  if (!rawUserId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const userId = rawUserId.toString();
  const cacheKey = `subscription:user:${userId}`;

  try {
    const cachedSub = await safeCacheGet(cacheKey);
    if (cachedSub) {
      return res.status(200).json({
        source: 'cache',
        data: JSON.parse(cachedSub),
      });
    }

    const subscription = await Subscription.findOne({ userId })
      .sort({ createdAt: -1 })
      .lean();

    if (!subscription) {
      return res.status(404).json({ message: 'No subscription found for this user' });
    }

    await safeCacheSet(cacheKey, JSON.stringify(subscription));

    return res.status(200).json({
      source: 'database',
      data: subscription,
    });
  } catch (err) {
    console.error('Error in getMySubscription:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Logged-in user ke saare subscriptions fetch karne ke liye
export const getMySubscriptions = async (req, res) => {
  const rawUserId = getUserIdFromReq(req);
  if (!rawUserId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const userId = rawUserId.toString();
  const cacheKey = `subscriptions:user:${userId}`;

  try {
    const cachedSubs = await safeCacheGet(cacheKey);
    if (cachedSubs) {
      return res.status(200).json({
        source: 'cache',
        data: JSON.parse(cachedSubs),
      });
    }

    const subscriptions = await Subscription.find({ userId })
      .sort({ createdAt: -1 })
      .lean();

    await safeCacheSet(cacheKey, JSON.stringify(subscriptions));

    return res.status(200).json({
      source: 'database',
      data: subscriptions,
    });
  } catch (err) {
    console.error('Error in getMySubscriptions:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ID se ek single subscription fetch karne ke liye
export const getSubscriptionById = async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid subscription ID' });
  }

  const rawUserId = getUserIdFromReq(req);
  if (!rawUserId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const cacheKey = `subscription:${id}`;

  try {
    let subscription;
    let source = 'database';

    const cachedSub = await safeCacheGet(cacheKey);
    if (cachedSub) {
      subscription = JSON.parse(cachedSub);
      source = 'cache';
    } else {
      subscription = await Subscription.findById(id).lean();
      if (!subscription) {
        return res.status(404).json({ message: 'Subscription not found' });
      }
      await safeCacheSet(cacheKey, JSON.stringify(subscription));
    }

    const ownerId = subscription.userId?.toString();
    if (ownerId !== rawUserId.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden: access denied to this subscription' });
    }

    return res.status(200).json({
      source,
      data: subscription,
    });
  } catch (err) {
    console.error('Error in getSubscriptionById:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Subscription update / upgrade / cancel karne ke liye
export const updateSubscription = async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid subscription ID' });
  }

  const rawUserId = getUserIdFromReq(req);
  if (!rawUserId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const existingSub = await Subscription.findById(id);
    if (!existingSub) {
      return res.status(404).json({ message: 'Subscription not found' });
    }

    const ownerId = existingSub.userId?.toString();
    if (ownerId !== rawUserId.toString() && req.user.role !== 'admin') {
      return res
        .status(403)
        .json({ message: "Forbidden: you cannot update another user's subscription" });
    }

    const updates = {};
    if (typeof req.body.plan === 'string' && req.body.plan.trim()) {
      updates.plan = req.body.plan.trim().toLowerCase();
    }
    if (typeof req.body.status === 'string' && req.body.status.trim()) {
      updates.status = req.body.status.trim().toLowerCase();
    }
    if (req.body.currentPeriodEnd) {
      updates.currentPeriodEnd = new Date(req.body.currentPeriodEnd);
    }
    if (req.body.usageLimits && typeof req.body.usageLimits === 'object') {
      updates.usageLimits = req.body.usageLimits;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid fields provided for update' });
    }

    const updatedSub = await Subscription.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    }).lean();

    await clearUserSubscriptionCache(ownerId, id);

    return res.status(200).json({
      message: 'Subscription updated successfully',
      data: updatedSub,
    });
  } catch (err) {
    console.error('Error in updateSubscription:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Subscription delete karne ke liye
export const deleteSubscription = async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid subscription ID' });
  }

  const rawUserId = getUserIdFromReq(req);
  if (!rawUserId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const existingSub = await Subscription.findById(id);
    if (!existingSub) {
      return res.status(404).json({ message: 'Subscription not found' });
    }

    const ownerId = existingSub.userId?.toString();
    if (ownerId !== rawUserId.toString() && req.user.role !== 'admin') {
      return res
        .status(403)
        .json({ message: "Forbidden: you cannot delete another user's subscription" });
    }

    await Subscription.findByIdAndDelete(id);

    await clearUserSubscriptionCache(ownerId, id);

    return res.status(200).json({ message: 'Subscription deleted successfully' });
  } catch (err) {
    console.error('Error in deleteSubscription:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};