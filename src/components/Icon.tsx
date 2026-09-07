import {
  Wallet, PiggyBank, TrendingUp, Gem, Building, Shield, HandCoins, CircleDot,
  CreditCard, House, Car, Landmark, Coins, Smartphone, ShoppingBag,
  type LucideIcon,
} from 'lucide-react'

const map: Record<string, LucideIcon> = {
  wallet: Wallet, 'piggy-bank': PiggyBank, 'trending-up': TrendingUp, gem: Gem,
  building: Building, shield: Shield, 'hand-coins': HandCoins, 'circle-dot': CircleDot,
  'credit-card': CreditCard, house: House, car: Car, landmark: Landmark, coins: Coins,
  smartphone: Smartphone, 'shopping-bag': ShoppingBag,
}

const EMOJI_RE = /^\p{Emoji_Presentation}|\p{Extended_Pictographic}/u

export function isEmoji(name: string): boolean {
  return EMOJI_RE.test(name.trim())
}

export function Icon({ name, size = 20, className }: { name: string; size?: number; className?: string }) {
  if (isEmoji(name)) {
    return (
      <span
        className={className}
        style={{ fontSize: size * 0.85, lineHeight: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
      >
        {name}
      </span>
    )
  }
  const Cmp = map[name] ?? CircleDot
  return <Cmp size={size} className={className} />
}
