import { trackRawEvent } from "../runtime/track.js";
import { stringError } from "../shared/errors.js";

export function wrapProviderMethod(state, restoreFns, rootObj, dottedPath, options) {
  const steps = dottedPath.split(".");
  let parent = rootObj;

  for (let i = 0; i < steps.length - 1; i += 1) {
    parent = parent?.[steps[i]];
    if (!parent) {
      return;
    }
  }

  const methodName = steps[steps.length - 1];
  if (!parent || typeof parent[methodName] !== "function") {
    return;
  }

  const original = parent[methodName];
  parent[methodName] = function telemetryWrappedProviderMethod(...args) {
    const startedAt = Date.now();
    const model = options.modelExtractor ? options.modelExtractor(args) : undefined;
    const extra = options.extraExtractor ? options.extraExtractor(args) : undefined;

    const onSuccess = (result) => {
      trackRawEvent(state, {
        type: "provider_call",
        provider: options.provider,
        operation: options.operation,
        model: model ?? null,
        duration_ms: Date.now() - startedAt,
        success: true,
        ...extractTokenUsage(result),
        ...extra
      });
      return result;
    };

    const onError = (error) => {
      trackRawEvent(
        state,
        {
          type: "provider_call",
          provider: options.provider,
          operation: options.operation,
          model: model ?? null,
          duration_ms: Date.now() - startedAt,
          success: false,
          error_message: stringError(error),
          ...extra
        },
        { forceKeep: true }
      );
      throw error;
    };

    try {
      const out = original.apply(this, args);
      if (out && typeof out.then === "function") {
        return out.then(onSuccess).catch(onError);
      }
      return onSuccess(out);
    } catch (error) {
      return onError(error);
    }
  };

  restoreFns.push(() => {
    parent[methodName] = original;
  });
}

export function extractTokenUsage(result) {
  const usage = result?.usage ?? result?.response?.usageMetadata ?? result?.response?.usage;
  if (!usage) {
    return {};
  }

  return {
    input_tokens:
      usage.input_tokens ??
      usage.prompt_tokens ??
      usage.promptTokenCount ??
      usage.inputTokenCount ??
      null,
    output_tokens:
      usage.output_tokens ??
      usage.completion_tokens ??
      usage.candidatesTokenCount ??
      usage.outputTokenCount ??
      null,
    total_tokens: usage.total_tokens ?? usage.totalTokenCount ?? null
  };
}
