export function getProductInfo(name: string): string {
  const normalized = name.replace(/\s/g, '')
  const products: Record<string, string> = {
    'CNC精密车削件': '适用于轴套、连接件、螺纹件等圆柱类零件，支持不锈钢、铝合金、黄铜等材质，常规精度 ±0.01mm。',
    '数控精密铣削件': '适用于支架、底座、精密结构件，支持多面加工和关键尺寸检验。',
    '钣金冲压件': '适用于机箱、支撑片、安装件等产品，支持折弯、冲压、表面处理。'
  }
  return products[normalized] || '暂无该产品详细信息'
}

export function getPrice(name: string): string {
  const normalized = name.replace(/\s/g, '')
  const prices: Record<string, string> = {
    'CNC精密车削件': '¥ 0.80 / 件起',
    '数控精密铣削件': '¥ 8.00 / 件起',
    '钣金冲压件': '¥ 1.20 / 件起'
  }
  return prices[normalized] || '暂无报价，请提供图纸或样品'
}
export function getProcessInfo(): string {
  return '机械零件定制流程：01 提供设备用途、图纸或样件并评估要求 → 02 确认材质、尺寸、工艺与报价 → 03 按约定打样或批量交付。'
}