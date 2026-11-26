import bcrypt from 'bcryptjs';
import redisClient from '../Config/redisClient.js';
import User from '../Models/userModel.js';
import { generateToken } from '../Utils/generateToken.js';

const CACHE_TTL = 3600; // 1 hour

const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

const getCache = async (key) => {
  if (typeof redisClient?.get !== 'function') return null;
  try {
    return await redisClient.get(key);
  } catch (err) {
    console.warn(`Redis GET skipped (${key}):`, err.message);
    return null;
  }
};

const setCache = async (key, value, ttlSeconds = CACHE_TTL) => {
  if (typeof redisClient?.set !== 'function') return;
  try {
    await redisClient.set(key, value, { EX: ttlSeconds });
  } catch (err) {
    console.warn(`Redis SET skipped (${key}):`, err.message);
  }
};

const delCache = async (...keys) => {
  if (typeof redisClient?.del !== 'function') return;
  try {
    for (const key of keys) {
      await redisClient.del(key);
    }
  } catch (err) {
    console.warn('Redis DEL skipped:', err.message);
  }
};

// Register / Sign Up
export const registerUser = async (req, res) => {
  try {
    let { name, email, password,role } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password are required' });
    }

    name = String(name).trim();
    email = String(email).trim().toLowerCase();
    password = String(password);

    if (!name || !email) {
      return res.status(400).json({ message: 'Valid name and email are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    const existingUser = await User.findOne({ email }).lean();
    if (existingUser) {
      return res.status(409).json({ message: 'User already exists' });
    }

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = await User.create({
      name,
      email,
      password: hashedPassword,
      role
    });

    await delCache('users:all');

    const token = generateToken(newUser._id.toString());

    return res.status(201).json({
      message: 'User registered successfully',
      token,
      data: {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'User already exists' });
    }
    console.error('Error in registerUser:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const createUser = registerUser;

// Sign In / Login
export const loginUser = async (req, res) => {
  try {
    let { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    email = String(email).trim().toLowerCase();
    password = String(password);

    const user = await User.findOne({ email }).select('+password');

    if (!user || !user.password) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = generateToken(user._id.toString());

    return res.status(200).json({
      message: 'Sign in successful',
      token,
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('Error in loginUser:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getUsers = async (req, res) => {
  const cacheKey = 'users:all';

  try {
    const cachedUsers = await getCache(cacheKey);
    if (cachedUsers) {
      return res.status(200).json({
        source: 'cache',
        data: JSON.parse(cachedUsers),
      });
    }

    const users = await User.find().select('-password').lean();
    await setCache(cacheKey, JSON.stringify(users), CACHE_TTL);

    return res.status(200).json({
      source: 'database',
      data: users,
    });
  } catch (err) {
    console.error('Error in getUsers:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getUserById = async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid user ID' });
  }

  const cacheKey = `user:${id}`;

  try {
    const cachedUser = await getCache(cacheKey);
    if (cachedUser) {
      return res.status(200).json({
        source: 'cache',
        data: JSON.parse(cachedUser),
      });
    }

    const user = await User.findById(id).select('-password').lean();
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    await setCache(cacheKey, JSON.stringify(user), CACHE_TTL);

    return res.status(200).json({
      source: 'database',
      data: user,
    });
  } catch (err) {
    console.error('Error in getUserById:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const updateUser = async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid user ID' });
  }

  if (req.user._id.toString() !== id && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Forbidden: you cannot update another user' });
  }

  try {
    const updates = {};
    if (typeof req.body.name === 'string' && req.body.name.trim()) {
      updates.name = req.body.name.trim();
    }
    if (typeof req.body.email === 'string' && req.body.email.trim()) {
      updates.email = req.body.email.trim().toLowerCase();
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid fields provided for update' });
    }

    const updatedUser = await User.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    })
      .select('-password')
      .lean();

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    await delCache(`user:${id}`, 'users:all');

    return res.status(200).json({
      message: 'User updated successfully',
      data: updatedUser,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Email already in use' });
    }
    console.error('Error in updateUser:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const deleteUser = async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid user ID' });
  }

  if (req.user._id.toString() !== id && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Forbidden: you cannot delete another user' });
  }

  try {
    const deletedUser = await User.findByIdAndDelete(id).lean();
    if (!deletedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    await delCache(`user:${id}`, 'users:all');

    return res.status(200).json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error('Error in deleteUser:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};