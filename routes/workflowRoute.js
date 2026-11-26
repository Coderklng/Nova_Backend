import express from 'express';
import {
  createWorkflow,
  getMyWorkflows,
  getWorkflowById,
  updateWorkflow,
  deleteWorkflow,
} from '../Controllers/workflowController.js';
import { protect,authorizeAdmin } from "../Middlewares/auth/jwtVerification.js";

const workflowRoute = express.Router();

workflowRoute.use(protect);

workflowRoute.post('/', createWorkflow);
workflowRoute.get('/', getMyWorkflows);
workflowRoute.get('/:id', getWorkflowById);
workflowRoute.put('/:id', updateWorkflow);
workflowRoute.delete('/:id', deleteWorkflow);

export default workflowRoute;