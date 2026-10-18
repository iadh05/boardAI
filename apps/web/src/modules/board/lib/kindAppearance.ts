import type { DiagramShape } from '@designroom/diagram';
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

// How each kind looks, in the toolbar and on the diagram. Module-level: both pods use it.

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

/** The outline of each kind, in draw.io / cloud-architecture style (ADR-004). */
export const KIND_SHAPE: Record<NodeKind, DiagramShape> = {
  client: 'device',
  cdn: 'ellipse',
  loadBalancer: 'hexagon',
  api: 'rectangle',
  service: 'rounded',
  cache: 'rounded',
  database: 'cylinder',
  storage: 'cylinder',
  queue: 'queue',
  custom: 'dashed',
};

/** Colour by family (theme tokens in index.css). Custom stays neutral: it could be anything. */
export const KIND_COLOR: Record<NodeKind, string> = {
  client: 'var(--color-kind-edge)',
  cdn: 'var(--color-kind-edge)',
  loadBalancer: 'var(--color-kind-network)',
  api: 'var(--color-kind-compute)',
  service: 'var(--color-kind-compute)',
  cache: 'var(--color-kind-cache)',
  database: 'var(--color-kind-data)',
  storage: 'var(--color-kind-data)',
  queue: 'var(--color-kind-messaging)',
  custom: 'var(--color-muted)',
};

/** Toolbar order: the known kinds as the domain lists them, then Custom. */
export const TOOLBAR_KINDS: readonly NodeKind[] = [...KNOWN_KINDS, 'custom'];
