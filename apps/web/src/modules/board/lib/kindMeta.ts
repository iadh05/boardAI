import { KIND_DEFAULT_LABEL, KNOWN_KINDS, type NodeKind } from '@designroom/domain';
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

export type KindMeta = {
  icon: LucideIcon;
  /** Human name of the kind ("Load Balancer"); also the default label of a new node. */
  name: string;
};

const ICONS: Record<NodeKind, LucideIcon> = {
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

/** How each kind looks in the toolbar and on the canvas. Module-level: toolbar and node pods both use it. */
export const KIND_META: Record<NodeKind, KindMeta> = Object.fromEntries(
  (Object.keys(ICONS) as NodeKind[]).map((kind) => [
    kind,
    { icon: ICONS[kind], name: KIND_DEFAULT_LABEL[kind] },
  ]),
) as Record<NodeKind, KindMeta>;

/** Toolbar order: the known kinds as the domain lists them, then Custom. */
export const TOOLBAR_KINDS: readonly NodeKind[] = [...KNOWN_KINDS, 'custom'];
