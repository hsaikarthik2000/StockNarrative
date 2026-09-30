import type { WorkerEnv } from '../../env';
import { conversationSystemPrompt } from './prompts';
import type { ConversationRequest, ConversationStream, ConversationTurn } from './types';

const DEFAULT_MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8' as const;

export async function streamConversation(
  env: Pick<WorkerEnv, 'AI'>,
  request: ConversationRequest,
  history: ConversationTurn[],
): Promise<ConversationStream> {
  const modelInput: AiTextGenerationInput & { stream: true } = {
    stream: true,
    temperature: 0.2,
    max_tokens: 512,
    messages: [
      { role: 'system', content: conversationSystemPrompt(request.style ?? 'formal') },
      ...history.slice(-20).map((turn) => ({ role: turn.role, content: turn.content })),
      ...(request.toolContext ? [{ role: 'system' as const, content: `Use this verified evidence as the highest-priority source for the current answer. Do not repeat any earlier fallback that says tools are unavailable. ${request.toolContext}` }] : []),
      { role: 'user', content: request.toolContext ? `${request.message}\n\n${request.toolContext}` : request.message },
    ],
  };
  let modelStream: ReadableStream;
  try {
    modelStream = await env.AI.run(DEFAULT_MODEL, modelInput);
  } catch (firstError) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    try {
      modelStream = await env.AI.run(DEFAULT_MODEL, modelInput);
    } catch {
      throw firstError;
    }
  }
  const [clientStream, captureStream] = modelStream.tee();
  const completion = collectResponseText(captureStream);
  return { stream: clientStream, completion, followUps: completion.then((answer) => generateFollowUps(env, request, answer)) };
}

async function generateFollowUps(
  env: Pick<WorkerEnv, 'AI'>,
  request: ConversationRequest,
  answer: string,
): Promise<string[]> {
  if (!answer) return [];
  try {
    const result = await env.AI.run(DEFAULT_MODEL, {
      temperature: 0.35,
      max_tokens: 120,
      messages: [
        { role: 'system', content: 'You create exactly two concise follow-up questions for a financial assistant. Return only a valid JSON array of two strings. Do not answer the questions. Keep each question under 90 characters.' },
        { role: 'user', content: `The user asked: ${request.message}\nThe assistant answered: ${answer}\nReturn two useful next questions that build on this answer.` },
      ],
    });
    const raw = typeof result.response === 'string' ? result.response : '';
    const json = raw.match(/\[[\s\S]*\]/)?.[0];
    if (!json) return [];
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()).slice(0, 2);
  } catch {
    return [];
  }
}

async function collectResponseText(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let response = '';

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    pending += decoder.decode(chunk.value, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      const data = line.startsWith('data:') ? line.slice(5).trim() : line.trim();
      if (!data || data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data) as { response?: unknown };
        if (typeof parsed.response === 'string') response += parsed.response;
      } catch {
        continue;
      }
    }
  }

  return response.trim();
}