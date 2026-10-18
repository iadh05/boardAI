import { KNOWN_KINDS, type NodeKind } from '@designroom/domain';
import {
  Boxes,
  Database,
  Globe,
  HardDrive,
  ListOrdered,
  Monitor,
  Network,
  Server,
  Shapes,
  Zap,
  type LucideIcon,
} from 'lucide-react';

// How each kind looks, in the toolbar and on the canvas. Module-level: both pods use it.

/** One icon per kind, so kinds are told apart at a glance. */
export const KIND_ICON: Record<NodeKind, LucideIcon> = {
  client: Monitor,
  cdn: Globe,
  loadBalancer: Network,
  api: Server,
  service: Boxes,
  cache: Zap,
  database: Database,
  queue: ListOrdered,
  storage: HardDrive,
  custom: Shapes,
};

/**
 * Icon colours by family (theme tokens in index.css). Full class names, written out, so
 * Tailwind finds them. Custom stays neutral: it could be anything.
 */
export const KIND_TONE: Record<NodeKind, string> = {
  client: 'bg-kind-edge/10 text-kind-edge',
  cdn: 'bg-kind-edge/10 text-kind-edge',
  loadBalancer: 'bg-kind-network/10 text-kind-network',
  api: 'bg-kind-compute/10 text-kind-compute',
  service: 'bg-kind-compute/10 text-kind-compute',
  cache: 'bg-kind-cache/10 text-kind-cache',
  database: 'bg-kind-data/10 text-kind-data',
  storage: 'bg-kind-data/10 text-kind-data',
  queue: 'bg-kind-messaging/10 text-kind-messaging',
  custom: 'bg-surface-hover text-muted',
};

/** Toolbar order: the known kinds as the domain lists them, then Custom. */
export const TOOLBAR_KINDS: readonly NodeKind[] = [...KNOWN_KINDS, 'custom'];
