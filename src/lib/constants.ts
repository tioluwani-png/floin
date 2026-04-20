export const SALES_CHANNELS = [
  { id: 'instagram', label: 'Instagram DM', icon: '📷' },
  { id: 'whatsapp', label: 'WhatsApp', icon: '💬' },
  { id: 'tiktok', label: 'TikTok DM', icon: '🎵' },
  { id: 'twitter', label: 'Twitter/X DM', icon: '🐦' },
  { id: 'distributor', label: 'Distributor', icon: '🏪' },
  { id: 'website', label: 'Website', icon: '🌐' },
  { id: 'walkin', label: 'Walk-in', icon: '🚶' },
  { id: 'other', label: 'Other', icon: '📦' },
] as const

export const EXPENSE_CATEGORIES = [
  { id: 'production', label: 'Production / Printing' },
  { id: 'logistics', label: 'Logistics / Delivery' },
  { id: 'marketing', label: 'Marketing & Ads' },
  { id: 'packaging', label: 'Packaging' },
  { id: 'software', label: 'App / Software' },
  { id: 'amenities', label: 'Amenities' },
] as const

export const BUSINESS_TYPES = [
  { id: 'product', label: 'Product-based' },
  { id: 'service', label: 'Service-based' },
  { id: 'hybrid', label: 'Hybrid' },
] as const

export const CURRENCY = {
  code: 'NGN',
  symbol: '₦',
  name: 'Nigerian Naira',
}
