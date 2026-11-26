import express from 'express';
import {
  registerUser,
  loginUser,
  getUsers,
  getUserById,
  updateUser,
  deleteUser,
} from '../Controllers/userController.js';
import { protect,authorizeAdmin } from '../Middlewares/auth/jwtVerification.js';

const userRoute = express.Router();

// Public routes
//
userRoute.post('/register', registerUser);
userRoute.post('/login', loginUser);

// Protected routes
userRoute.get('/', protect,authorizeAdmin, getUsers);
userRoute.get('/:id', protect, getUserById);
userRoute.put('/:id', protect, updateUser);
userRoute.delete('/:id', protect, deleteUser);

export default userRoute;