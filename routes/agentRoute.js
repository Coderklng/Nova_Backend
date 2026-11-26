import express from 'express';
import {
  createAgent,
  getMyAgents,
  getAgentById,
  updateAgent,
  deleteAgent,
} from '../Controllers/agentController.js';
import { protect,authorizeAdmin } from '../Middlewares/auth/jwtVerification.js';

const agentRoute = express.Router();

agentRoute.use(protect);

agentRoute.post('/', createAgent);
agentRoute.get('/', getMyAgents);
agentRoute.get('/:id', getAgentById);
agentRoute.put('/:id', updateAgent);
agentRoute.delete('/:id', deleteAgent);

export default agentRoute;