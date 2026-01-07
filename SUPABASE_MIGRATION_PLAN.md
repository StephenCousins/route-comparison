# Supabase Migration Plan

This document outlines the migration from Firebase to Supabase with Stripe integration for paid subscriptions.

## Current Architecture (Firebase)

```
Frontend (Static HTML/JS)
    ↓
Firebase Auth (Google Sign-in)
    ↓
Firestore (NoSQL)
    └── users/{userId}/sessions/{sessionId}
            └── routes[], createdAt, routeCount
```

## Target Architecture (Supabase + Stripe)

```
Frontend (Static HTML/JS)
    ↓
Supabase Auth (Google OAuth)
    ↓
Supabase PostgreSQL
    ├── users (profiles, subscription status)
    ├── subscriptions (Stripe sync)
    └── sessions (route comparisons)

Stripe ←→ Supabase Edge Functions (webhooks)
```

---

## Phase 1: Database Schema

### PostgreSQL Tables

```sql
-- Users table (extends Supabase auth.users)
CREATE TABLE public.profiles (
    id UUID REFERENCES auth.users(id) PRIMARY KEY,
    email TEXT,
    display_name TEXT,
    avatar_url TEXT,
    subscription_tier TEXT DEFAULT 'free', -- 'free', 'pro', 'team'
    subscription_status TEXT DEFAULT 'inactive', -- 'active', 'inactive', 'past_due', 'cancelled'
    stripe_customer_id TEXT UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Subscriptions table (synced from Stripe)
CREATE TABLE public.subscriptions (
    id TEXT PRIMARY KEY, -- Stripe subscription ID
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    stripe_customer_id TEXT,
    stripe_price_id TEXT,
    status TEXT, -- 'active', 'past_due', 'cancelled', 'trialing'
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sessions table (saved route comparisons)
CREATE TABLE public.sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    name TEXT,
    route_count INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Routes table (individual routes within sessions)
CREATE TABLE public.routes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE,
    display_name TEXT,
    file_name TEXT,
    color TEXT,
    distance DECIMAL,
    duration INTEGER,
    elevation_gain DECIMAL,
    elevation_loss DECIMAL,
    coordinates JSONB, -- Compressed coordinate array
    elevations JSONB,
    speeds JSONB,
    paces JSONB,
    timestamps JSONB,
    heart_rates JSONB,
    cadences JSONB,
    powers JSONB,
    compression_factor INTEGER DEFAULT 1,
    original_point_count INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_sessions_user_id ON public.sessions(user_id);
CREATE INDEX idx_routes_session_id ON public.routes(session_id);
CREATE INDEX idx_subscriptions_user_id ON public.subscriptions(user_id);
```

### Row Level Security (RLS)

```sql
-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read/update their own profile
CREATE POLICY "Users can view own profile"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id);

-- Sessions: users can CRUD their own sessions
CREATE POLICY "Users can view own sessions"
    ON public.sessions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create sessions"
    ON public.sessions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own sessions"
    ON public.sessions FOR DELETE
    USING (auth.uid() = user_id);

-- Routes: access through session ownership
CREATE POLICY "Users can view own routes"
    ON public.routes FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.sessions
            WHERE sessions.id = routes.session_id
            AND sessions.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can create routes in own sessions"
    ON public.routes FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.sessions
            WHERE sessions.id = routes.session_id
            AND sessions.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete own routes"
    ON public.routes FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.sessions
            WHERE sessions.id = routes.session_id
            AND sessions.user_id = auth.uid()
        )
    );

-- Subscriptions: users can view their own
CREATE POLICY "Users can view own subscriptions"
    ON public.subscriptions FOR SELECT
    USING (auth.uid() = user_id);
```

---

## Phase 2: Supabase Setup

### 2.1 Create Supabase Project
1. Go to https://supabase.com and create new project
2. Note down: Project URL, Anon Key, Service Role Key

### 2.2 Configure Google OAuth
1. Supabase Dashboard → Authentication → Providers → Google
2. Add your Google OAuth credentials (same ones used for Firebase)
3. Update authorized redirect URIs in Google Console

### 2.3 Environment Variables (Railway)
```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbG...
SUPABASE_SERVICE_ROLE_KEY=eyJhbG... (for edge functions only)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID_PRO=price_...
```

---

## Phase 3: Stripe Integration

### 3.1 Stripe Products & Prices
Create in Stripe Dashboard:
- Product: "Route Comparison Pro"
  - Price: $7/month (price_xxx)
  - Price: $60/year (price_yyy)

### 3.2 Supabase Edge Function: Stripe Webhook

```typescript
// supabase/functions/stripe-webhook/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@12.0.0'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
})

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

serve(async (req) => {
  const signature = req.headers.get('stripe-signature')!
  const body = await req.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!
    )
  } catch (err) {
    return new Response(`Webhook Error: ${err.message}`, { status: 400 })
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      await handleCheckoutComplete(session)
      break
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription
      await handleSubscriptionChange(subscription)
      break
    }
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 })
})

async function handleCheckoutComplete(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.user_id
  const subscriptionId = session.subscription as string

  // Get subscription details from Stripe
  const subscription = await stripe.subscriptions.retrieve(subscriptionId)

  // Update user profile
  await supabase
    .from('profiles')
    .update({
      stripe_customer_id: session.customer as string,
      subscription_tier: 'pro',
      subscription_status: 'active',
    })
    .eq('id', userId)

  // Insert subscription record
  await supabase.from('subscriptions').upsert({
    id: subscriptionId,
    user_id: userId,
    stripe_customer_id: session.customer as string,
    stripe_price_id: subscription.items.data[0].price.id,
    status: subscription.status,
    current_period_start: new Date(subscription.current_period_start * 1000),
    current_period_end: new Date(subscription.current_period_end * 1000),
  })
}

async function handleSubscriptionChange(subscription: Stripe.Subscription) {
  const { error } = await supabase
    .from('subscriptions')
    .update({
      status: subscription.status,
      current_period_end: new Date(subscription.current_period_end * 1000),
      cancel_at_period_end: subscription.cancel_at_period_end,
    })
    .eq('id', subscription.id)

  // Update profile subscription status
  if (subscription.status === 'active') {
    await supabase
      .from('profiles')
      .update({ subscription_status: 'active', subscription_tier: 'pro' })
      .eq('stripe_customer_id', subscription.customer as string)
  } else if (['cancelled', 'unpaid'].includes(subscription.status)) {
    await supabase
      .from('profiles')
      .update({ subscription_status: 'inactive', subscription_tier: 'free' })
      .eq('stripe_customer_id', subscription.customer as string)
  }
}
```

### 3.3 Supabase Edge Function: Create Checkout Session

```typescript
// supabase/functions/create-checkout/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@12.0.0'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
})

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { priceId } = await req.json()

  const session = await stripe.checkout.sessions.create({
    customer_email: user.email,
    line_items: [{ price: priceId, quantity: 1 }],
    mode: 'subscription',
    success_url: `${req.headers.get('origin')}/success`,
    cancel_url: `${req.headers.get('origin')}/`,
    metadata: { user_id: user.id },
  })

  return new Response(JSON.stringify({ url: session.url }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
```

---

## Phase 4: Frontend Changes

### 4.1 New File: `src/js/SupabaseManager.js`

```javascript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { config } from './config.js'

const supabase = createClient(config.supabase.url, config.supabase.anonKey)

export class SupabaseAuthManager {
    constructor() {
        this.currentUser = null
    }

    async signInWithGoogle() {
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin
            }
        })
        if (error) throw error
        return data
    }

    async signOut() {
        const { error } = await supabase.auth.signOut()
        if (error) throw error
        this.currentUser = null
    }

    onAuthStateChanged(callback) {
        supabase.auth.onAuthStateChange((event, session) => {
            this.currentUser = session?.user || null
            callback(this.currentUser)
        })
    }

    getCurrentUser() {
        return this.currentUser
    }

    async getSubscriptionStatus() {
        if (!this.currentUser) return 'free'

        const { data } = await supabase
            .from('profiles')
            .select('subscription_tier, subscription_status')
            .eq('id', this.currentUser.id)
            .single()

        return data?.subscription_status === 'active' ? data.subscription_tier : 'free'
    }
}

export class SupabaseStorageManager {
    constructor() {
        this.userId = null
    }

    setUser(userId) {
        this.userId = userId
    }

    async saveSession(routes, sessionName = null) {
        if (!this.userId) return false

        // Create session
        const { data: session, error: sessionError } = await supabase
            .from('sessions')
            .insert({
                user_id: this.userId,
                name: sessionName || `Session ${new Date().toLocaleDateString()}`,
                route_count: routes.length
            })
            .select()
            .single()

        if (sessionError) throw sessionError

        // Insert routes
        const routesData = routes.map(route => ({
            session_id: session.id,
            display_name: route.displayName,
            file_name: route.fileName,
            color: route.color,
            distance: route.distance,
            duration: route.duration,
            elevation_gain: route.elevationStats?.gain || 0,
            elevation_loss: route.elevationStats?.loss || 0,
            coordinates: this.compressArray(route.coordinates),
            elevations: this.compressArray(route.elevations),
            speeds: this.compressArray(route.speeds),
            paces: this.compressArray(route.paces),
            timestamps: this.compressArray(route.timestamps),
            heart_rates: route.heartRates ? this.compressArray(route.heartRates) : null,
            cadences: route.cadences ? this.compressArray(route.cadences) : null,
            powers: route.powers ? this.compressArray(route.powers) : null,
        }))

        const { error: routesError } = await supabase
            .from('routes')
            .insert(routesData)

        if (routesError) throw routesError

        return session.id
    }

    async getSavedSessions() {
        if (!this.userId) return []

        const { data, error } = await supabase
            .from('sessions')
            .select('*')
            .eq('user_id', this.userId)
            .order('created_at', { ascending: false })
            .limit(20)

        if (error) throw error
        return data || []
    }

    async loadSession(sessionId) {
        const { data: session } = await supabase
            .from('sessions')
            .select('*')
            .eq('id', sessionId)
            .single()

        const { data: routes } = await supabase
            .from('routes')
            .select('*')
            .eq('session_id', sessionId)

        return { ...session, routes }
    }

    async deleteSession(sessionId) {
        const { error } = await supabase
            .from('sessions')
            .delete()
            .eq('id', sessionId)

        return !error
    }

    compressArray(arr, factor = null) {
        if (!arr || arr.length === 0) return []

        const compressionFactor = factor || (arr.length > 5000 ? Math.ceil(arr.length / 2500) : 1)
        if (compressionFactor === 1) return arr

        const compressed = []
        for (let i = 0; i < arr.length; i += compressionFactor) {
            compressed.push(arr[i])
        }
        return compressed
    }
}

// Stripe checkout helper
export async function createCheckoutSession(priceId) {
    const { data, error } = await supabase.functions.invoke('create-checkout', {
        body: { priceId }
    })

    if (error) throw error
    if (data.url) window.location.href = data.url
}

export { supabase }
```

### 4.2 Update `config.js` Template

```javascript
export const config = {
    supabase: {
        url: "${SUPABASE_URL}",
        anonKey: "${SUPABASE_ANON_KEY}"
    },
    googleMaps: {
        apiKey: "${GOOGLE_MAPS_API_KEY}"
    },
    stripe: {
        priceIdMonthly: "${STRIPE_PRICE_ID_MONTHLY}",
        priceIdYearly: "${STRIPE_PRICE_ID_YEARLY}"
    }
}
```

### 4.3 Update `start.sh`

```bash
#!/bin/bash

cat > src/js/config.js << EOF
export const config = {
    supabase: {
        url: "${SUPABASE_URL}",
        anonKey: "${SUPABASE_ANON_KEY}"
    },
    googleMaps: {
        apiKey: "${GOOGLE_MAPS_API_KEY}"
    },
    stripe: {
        priceIdMonthly: "${STRIPE_PRICE_ID_MONTHLY}",
        priceIdYearly: "${STRIPE_PRICE_ID_YEARLY}"
    }
}
EOF

echo "Generated config.js from environment variables"
exec serve -s src -l ${PORT:-3000}
```

---

## Phase 5: Feature Gating

### Free vs Pro Features

```javascript
// In app.js - check subscription before premium features
async function checkFeatureAccess(feature) {
    const tier = await authManager.getSubscriptionStatus()

    const premiumFeatures = ['export-csv', 'unlimited-saves', 'insights', 'segment-analysis']

    if (premiumFeatures.includes(feature) && tier === 'free') {
        showUpgradeModal()
        return false
    }
    return true
}

// Usage
async function exportComparisonCSV() {
    if (!await checkFeatureAccess('export-csv')) return
    // ... existing export code
}
```

### Suggested Feature Tiers

| Feature | Free | Pro |
|---------|------|-----|
| Upload & compare routes | 2 routes | Unlimited |
| Save sessions | 3 sessions | Unlimited |
| Time Gap analysis | Yes | Yes |
| Split comparison | Yes | Yes |
| Segment analysis | No | Yes |
| Export CSV | No | Yes |
| Insights & analytics | No | Yes |
| Route heatmaps | No | Yes |

---

## Phase 6: Migration Steps

### 6.1 One-time Data Migration (Optional)
If you have existing Firebase users/data to migrate:

```javascript
// Migration script (run once)
async function migrateFromFirebase() {
    // 1. Export users from Firebase Auth
    // 2. Create profiles in Supabase
    // 3. Export Firestore sessions
    // 4. Insert into Supabase sessions/routes tables
}
```

### 6.2 Deployment Checklist

1. [ ] Create Supabase project
2. [ ] Run SQL schema (Phase 1)
3. [ ] Configure Google OAuth in Supabase
4. [ ] Create Stripe products and prices
5. [ ] Deploy Supabase Edge Functions
6. [ ] Add Stripe webhook endpoint in Stripe Dashboard
7. [ ] Update Railway environment variables
8. [ ] Replace FirebaseManager with SupabaseManager in app.js
9. [ ] Add upgrade UI/modal
10. [ ] Test full flow: signup → checkout → access premium features
11. [ ] Remove Firebase dependencies from index.html

---

## Estimated Effort

| Phase | Effort |
|-------|--------|
| Phase 1: Database Schema | 1 hour |
| Phase 2: Supabase Setup | 1-2 hours |
| Phase 3: Stripe Integration | 3-4 hours |
| Phase 4: Frontend Changes | 4-6 hours |
| Phase 5: Feature Gating | 2-3 hours |
| Phase 6: Migration & Testing | 2-3 hours |
| **Total** | **~15-20 hours** |

---

## Resources

- [Supabase Docs](https://supabase.com/docs)
- [Supabase + Stripe Guide](https://supabase.com/docs/guides/integrations/stripe)
- [Stripe Checkout](https://stripe.com/docs/checkout/quickstart)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
