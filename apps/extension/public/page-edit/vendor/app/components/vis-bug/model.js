import * as Icons from './vis-bug.icons.js'
import { metaKey, altKey } from '../../utilities/index.js'

export const VisBugModel = {
  g: {
    tool:        'guides',
    section:     'primary',
    icon:        Icons.guides,
    label:       '参考线',
    description: '查看对齐情况并测量元素间距',
    instruction: `<div table>
                    <div>
                      <b>元素参考线：</b>
                      <span>悬停</span>
                    </div>
                    <div>
                      <b>测量：</b>
                      <span>点击后悬停</span>
                    </div>
                    <div>
                      <b>固定测量：</b>
                      <span>Shift + 点击</span>
                    </div>
                  </div>`,
  },
  i: {
    tool:        'inspector',
    section:     'primary',
    icon:        Icons.inspector,
    label:       '检查样式',
    description: '查看元素当前样式和常用样式信息',
    instruction: `<div table>
                    <div>
                      <b>固定显示：</b>
                      <span>${altKey} + click</span>
                    </div>
                  </div>`,
  },
  x: {
    tool:        'accessibility',
    section:     'primary',
    icon:        Icons.accessibility,
    label:       '无障碍',
    description: '查看无障碍属性与合规状态',
    instruction: `<div table>
                    <div>
                      <b>固定显示：</b>
                      <span>${altKey} + click</span>
                    </div>
                  </div>`,
  },
  v: {
    tool:        'move',
    section:     'primary',
    icon:        Icons.move,
    label:       '移动',
    description: '移动元素位置，调整层级和容器内外关系',
    instruction: `<div table>
                    <div>
                      <b>横向移动：</b>
                      <span>点击容器后拖动子元素</span>
                    </div>
                    <div>
                      <b>横向移动：</b>
                      <span>◀ ▶</span>
                    </div>
                    <div>
                      <b>移出并上移：</b>
                      <span>▲</span>
                    </div>
                    <div>
                      <b>下移/移入/置底：</b>
                      <span>▼</span>
                    </div>
                  </div>`,
  },
  // r: {
  //   tool:        'resize',
  //   icon:        Icons.resize,
  //   label:       'Resize',
  //   description: ''
  // },
  m: {
    tool:        'margin',
    section:     'layout',
    icon:        Icons.margin,
    label:       '外边距',
    description: '增加或减少所选元素四周的外部留白',
    instruction: `<div table>
                    <div>
                      <b>增加外边距：</b>
                      <span>◀ ▶ ▲ ▼</span>
                    </div>
                    <div>
                      <b>减少外边距：</b>
                      <span>${altKey} + ◀ ▶ ▲ ▼</span>
                    </div>
                    <div>
                      <b>四边同时：</b>
                      <span>${metaKey} +  ▲ ▼</span>
                    </div>
                  </div>`,
  },
  p: {
    tool:        'padding',
    section:     'layout',
    icon:        Icons.padding,
    label:       '内边距',
    description: `增加或减少所选元素四周的内部留白`,
    instruction: `<div table>
                    <div>
                      <b>增加内边距：</b>
                      <span>◀ ▶ ▲ ▼</span>
                    </div>
                    <div>
                      <b>减少内边距：</b>
                      <span>${altKey} + ◀ ▶ ▲ ▼</span>
                    </div>
                    <div>
                      <b>四边同时：</b>
                      <span>${metaKey} +  ▲ ▼</span>
                    </div>
                  </div>`
  },
  // b: {
  //   tool:        'border',
  //   icon:        Icons.border,
  //   label:       'Border',
  //   description: ''
  // },
  a: {
    tool:        'align',
    section:     'layout',
    icon:        Icons.align,
    label:       '弹性布局',
    description: `创建或调整 Flex 布局方向、分布、顺序与换行`,
    instruction: `<div table>
                    <div>
                      <b>横向排列：</b>
                      <span>${metaKey} + ▼</span>
                    </div>
                    <div>
                      <b>纵向排列：</b>
                      <span>${metaKey} + ▶</span>
                    </div>
                    <div>
                      <b>对齐：</b>
                      <span>◀ ▶ ▲ ▼</span>
                    </div>
                    <div>
                      <b>分布：</b>
                      <span>Shift + ◀ ▶</span>
                    </div>
                    <div>
                      <b>顺序：</b>
                      <span>${metaKey} + shift + ◀ ▶</span>
                    </div>
                    <div>
                      <b>换行：</b>
                      <span>${metaKey} + shift + ▲ ▼</span>
                    </div>
                  </div>`,
  },
  h: {
    tool:        'hueshift',
    section:     'style',
    icon:        Icons.hueshift,
    label:       '颜色调整',
    description: `调整前景色、背景色的色相、亮度、饱和度与透明度`,
    instruction: `<div table>
                    <div>
                      <b>饱和度：</b>
                      <span>◀ ▶</span>
                    </div>
                    <div>
                      <b>亮度：</b>
                      <span>▲ ▼</span>
                    </div>
                    <div>
                      <b>色相：</b>
                      <span>${metaKey} +  ▲ ▼</span>
                    </div>
                    <div>
                      <b>透明度：</b>
                      <span>${metaKey} +  ◀ ▶</span>
                    </div>
                  </div>`,
  },
  d: {
    tool:        'boxshadow',
    section:     'style',
    icon:        Icons.boxshadow,
    label:       '阴影',
    description: `创建并调整阴影的位置、模糊和透明度`,
    instruction: `<div table>
                    <div>
                      <b>X/Y 位置：</b>
                      <span>◀ ▶ ▲ ▼</span>
                    </div>
                    <div>
                      <b>模糊：</b>
                      <span>${altKey} + ▲ ▼</span>
                    </div>
                    <div>
                      <b>扩散：</b>
                      <span>${altKey} + ◀ ▶</span>
                    </div>
                    <div>
                      <b>Opacity:</b>
                      <span>${metaKey} + ◀ ▶</span>
                    </div>
                  </div>`,
  },
  // t: {
  //   tool:        'transform',
  //   icon:        Icons.transform,
  //   label:       '3D Transform',
  //   description: ''
  // },
  l: {
    tool:        'position',
    section:     'layout',
    icon:        Icons.position,
    label:       '定位',
    description: '调整 SVG 的 x/y，以及元素的 top/left/bottom/right',
    instruction: `<div table>
                    <div>
                      <b>微调：</b>
                      <span>◀ ▶ ▲ ▼</span>
                    </div>
                    <div>
                      <b>移动：</b>
                      <span>点击并拖动</span>
                    </div>
                  </div>`,
  },
  f: {
    tool:        'font',
    section:     'style',
    icon:        Icons.font,
    label:       '字体样式',
    description: '调整字号、对齐、行高、字距和字重',
    instruction: `<div table>
                    <div>
                      <b>字号：</b>
                      <span>▲ ▼</span>
                    </div>
                    <div>
                      <b>对齐：</b>
                      <span>◀ ▶</span>
                    </div>
                    <div>
                      <b>行高：</b>
                      <span>Shift + ▲ ▼</span>
                    </div>
                    <div>
                      <b>字间距：</b>
                      <span>Shift + ◀ ▶</span>
                    </div>
                    <div>
                      <b>字重：</b>
                      <span>${metaKey} + ▲ ▼</span>
                    </div>
                  </div>`,
  },
  e: {
    tool:        'text',
    section:     'primary',
    icon:        Icons.text,
    label:       '编辑文本',
    description: '在页面上<b>双击</b>即可直接修改文本',
    instruction: '',
  },
  // c: {
  //   tool:        'screenshot',
  //   icon:        Icons.camera,
  //   label:       'Screenshot',
  //   description: 'Screenshot selected elements or the entire page'
  // },
  s: {
    tool:        'search',
    section:     'primary',
    icon:        Icons.search,
    label:       '搜索元素',
    description: '通过搜索条件选择元素，或使用内置命令触发特殊插件能力',
    instruction: '',
  },
}
