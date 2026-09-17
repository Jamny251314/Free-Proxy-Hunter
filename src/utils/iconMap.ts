import {
  Bot,
  Code,
  Globe,
  Sparkles,
  FileText,
  Lightbulb
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// Icon 映射
// 注意：使用 lucide 的 LucideIcon 类型。lucide 的 size 允许 string | number，
// 比手写的 { size?: number } 更宽，否则赋值处会报类型不兼容。
export const ICON_MAP: Record<string, LucideIcon> = {
  Bot,
  Sparkles,
  Code,
  FileText,
  Globe,
  Lightbulb,
};
