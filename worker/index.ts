import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { handleApiRequest, processScheduledReminders } from "../server/router";
import type { AssistantEnv } from "../server/types";

interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }
interface ScheduledController { scheduledTime: number; cron: string; }

const worker = {
  async fetch(request: Request, env: AssistantEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApiRequest(request, env);
    if (url.pathname === "/_vinext/image") {
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES]);
    }
    return handler.fetch(request, env, ctx);
  },
  async scheduled(controller: ScheduledController, env: AssistantEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(processScheduledReminders(env, new Date(controller.scheduledTime)));
  },
};

export default worker;
