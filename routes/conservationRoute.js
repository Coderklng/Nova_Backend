import express from 'express';
import {
  createConversation,
  getMyConversations,
  getConversationById,
  updateConversation,
  deleteConversation,
} from '../Controllers/conservationController.js';
import { protect,authorizeAdmin } from '../Middlewares/auth/jwtVerification.js';

const conservationRoute = express.Router();

conservationRoute.use(protect);

conservationRoute.post('/', createConversation);
conservationRoute.get('/', getMyConversations);
conservationRoute.get('/:id', getConversationById);
conservationRoute.put('/:id', updateConversation);
conservationRoute.delete('/:id', deleteConversation);

export default conservationRoute;