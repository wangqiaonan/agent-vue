export function getProductInfo(name: string): string {
  const products: Record<string, string> = {
    '传动轴及轴套': '用于机械传动与连接部位。具体结构、材质、尺寸和加工要求需根据设备用途及图纸或样件确认。',
    '轴承座': '用于轴承安装与支撑。安装尺寸、配合要求及材质需根据配套轴承、设备工况和图纸或样件确认。',
    '支架及连接件': '用于机械设备结构支撑与部件连接。规格、安装方式和材质需结合设备用途及图纸或样件确认。'
  }
  return products[name] || '暂无该产品详细信息'
}

export function getPrice(name: string): string {
  const prices: Record<string, string> = {
    '传动轴及轴套': '按图报价，需提供设备用途、图纸或样件及采购数量',
    '轴承座': '按图报价，需提供配套轴承信息、图纸或样件及采购数量',
    '支架及连接件': '按图报价，需提供设备用途、图纸或样件及采购数量'
  }
  return prices[name] || '暂无报价，请提供图纸或样品'
}

export function getProcessInfo(): string {
  return '机械零件定制流程：01 提供设备用途、图纸或样件并评估要求 → 02 确认材质、尺寸、工艺与报价 → 03 按约定打样或批量交付。'
}