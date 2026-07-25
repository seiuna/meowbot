import { z } from "zod";

export const AuthorSchema = z.object({
  name: z.string(),
  avatar: z.string().url("头像必须是有效的URL").optional(),
  bio: z.string().optional()
})

export const MetricSchema = z.object({
  label: z.string(),
  value: z.union([z.string(), z.number()]),
  icon: z.string().optional()
})

export const ProgressDataSchema = z.object({
  label: z.string(),
  percentage: z.number().min(0).max(100),
  statusText: z.string().optional()
})

export const CardDataSchema = z.object({
  title: z.string(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  author: AuthorSchema.optional(),
  metrics: z.array(MetricSchema).optional(),
  progress: ProgressDataSchema.optional(),
  theme: z.enum(['indigo', 'emerald', 'rose', 'amber', 'sky']).default('indigo'),
  content: z.string(),
  updatedAt: z.string().optional(),
})

export type CardData = z.infer<typeof CardDataSchema>
