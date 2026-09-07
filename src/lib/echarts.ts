/**
 * ECharts 按需引入 —— 仅注册本项目用到的图表类型、组件和渲染器。
 * 注意：echarts 包在 node_modules 中仍占 ~55MB（自带全部图表源码），
 * 这里的按需引入影响的是打包产物体积，而不是 node_modules 磁盘占用。
 */
import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart, SankeyChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  SankeyChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  SVGRenderer,
])

export default echarts
