import { type OperationResultEnvelope, TRPCClientError, type TRPCLink } from '@trpc/client';
import { getTransformer } from '@trpc/client/unstable-internals';
import type { AnyRouter } from '@trpc/server';
import { observable } from '@trpc/server/observable';

import { isTRPCResponse } from '../../shared/trpcMessage';
import type { MessengerMethods, TRPCChromeRequest } from '../../types';

export const createBaseLink = <TRouter extends AnyRouter>(
  methods: MessengerMethods
): TRPCLink<TRouter> => {
  return (_runtime) => {
    const transformer = getTransformer(undefined);

    return ({ op }) => {
      return observable((observer) => {
        const listeners: (() => void)[] = [];

        const { id, type, path } = op;

        try {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          const input = transformer.input.serialize(op.input);

          const onDisconnect = () => {
            observer.complete();
          };

          methods.addCloseListener(onDisconnect);
          listeners.push(() => methods.removeCloseListener(onDisconnect));

          const onMessage = (message: unknown) => {
            if (!isTRPCResponse(message)) return;
            const { trpc } = message;
            if (id !== trpc.id) return;

            if ('error' in trpc) {
              return observer.error(TRPCClientError.from(trpc));
            }

            observer.next({
              result: {
                ...trpc.result,
                ...((!trpc.result.type || trpc.result.type === 'data') && {
                  type: 'data',
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                  data: transformer.output.deserialize(trpc.result.data),
                }),
              },
            } as OperationResultEnvelope<unknown, TRPCClientError<TRouter>>);

            if (type !== 'subscription' || trpc.result.type === 'stopped') {
              observer.complete();
            }
          };

          methods.addMessageListener(onMessage);
          listeners.push(() => methods.removeMessageListener(onMessage));

          try {
            methods.postMessage({
              trpc: {
                id,
                jsonrpc: undefined,
                method: type,
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                params: { path, input },
              },
            } as TRPCChromeRequest);
          } catch (cause) {
            const message =
              cause instanceof Error ? cause.message : 'Failed to post message to background';
            if (message.includes('No SW') || message.includes('service worker unavailable')) {
              observer.complete();
              return;
            }
            throw cause;
          }
        } catch (cause) {
          observer.error(
            new TRPCClientError(cause instanceof Error ? cause.message : 'Unknown error')
          );
        }

        return () => {
          if (type === 'subscription') {
            try {
              methods.postMessage({
                trpc: {
                  id,
                  jsonrpc: undefined,
                  method: 'subscription.stop',
                },
              } as TRPCChromeRequest);
            } catch {
              // Ignore background teardown races during service worker reload.
            }
          }
          listeners.forEach((unsub) => unsub());
        };
      });
    };
  };
};
