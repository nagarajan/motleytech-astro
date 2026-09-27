import { avlEngine } from './avl';
import { bTreeEngine } from './btree';
import { redBlackEngine } from './redblack';
import { treapEngine } from './treap';
import type { AnyEngine, EngineId } from './types';

export const engineOrder: EngineId[] = ['avl', 'redblack', 'treap', 'btree'];

export const engines: Record<EngineId, AnyEngine> = {
  avl: avlEngine as unknown as AnyEngine,
  redblack: redBlackEngine as unknown as AnyEngine,
  treap: treapEngine as unknown as AnyEngine,
  btree: bTreeEngine as unknown as AnyEngine,
};
