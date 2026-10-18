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

/** The icon of each kind, in the toolbar and on the canvas. Module-level: toolbar and node pods both use it. */
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

/** Toolbar order: the known kinds as the domain lists them, then Custom. */
export const TOOLBAR_KINDS: readonly NodeKind[] = [...KNOWN_KINDS, 'custom'];
