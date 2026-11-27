//
export const sendMessageController = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { message, messages, sessionId, workspaceId } = req.body;

    if (!message && (!Array.isArray(messages) || messages.length === 0)) {
      return res.status(400).json({
        success: false,
        message: 'Message ya messages array bhejna zaroori hai.',
      });
    }

    // Yahan apne agents/ folder ka function call karo:
    // const agentReply = await runChatAgent({
    //   userId,
    //   workspaceId,
    //   sessionId,
    //   message,
    //   messages,
    //   subscription: req.subscription,
    // });

    return res.status(200).json({
      success: true,
      userId,
      // reply: agentReply,
      message: 'sendMessageController ready hai; agents/ wala function yahan connect kar do.',
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Chat message process karne mein error aaya.',
      error: error.message,
    });
  }
};