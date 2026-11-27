import express from 'express';
import { protect } from '../Middlewares/auth/jwtVerification.js';
import { checkChatSession } from '../Middlewares/subscriptionMiddleware.js';
import { sendMessageController } from '../Controllers/chatController.js';

const chatRoute = express.Router();

chatRoute.post('/chat', protect, checkChatSession, sendMessageController);

export default chatRoute;