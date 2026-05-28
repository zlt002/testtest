import * as Icons from './vis-bug.icons.js'

export const bottomToolbarTools = [
  { id: 'content', label: '内容编辑', interactionType: 'direct', feature: 'text', icon: Icons.text },
  { id: 'move', label: '位置移动', interactionType: 'direct', feature: 'position', icon: Icons.position },
  { id: 'resize', label: '宽高修改', interactionType: 'direct', feature: 'position', icon: Icons.resize },
  { id: 'padding', label: '内边距', interactionType: 'direct', feature: 'padding', icon: Icons.padding },
  { id: 'margin', label: '外边距', interactionType: 'direct', feature: 'margin', icon: Icons.margin },
  { id: 'flex', label: '弹性布局', interactionType: 'panel', feature: 'align', icon: Icons.align },
  { id: 'typography', label: '文本格式', interactionType: 'panel', feature: 'font', icon: Icons.font },
  { id: 'background', label: '背景设置', interactionType: 'panel', feature: 'background', icon: Icons.color_background },
  { id: 'reorder', label: '顺序调整', interactionType: 'direct', feature: 'move', icon: Icons.move },
]

export const getBottomToolbarTool = toolId =>
  bottomToolbarTools.find(tool => tool.id === toolId) ?? null
