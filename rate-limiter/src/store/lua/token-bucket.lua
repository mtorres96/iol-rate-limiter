-- Token Bucket (rl_tb) — ATOMIC Redis port of MemoryStore.tokenBucket()
-- (src/store/memory.ts L56-93). numberOfKeys: 1.
--
-- Parity contract (TEST-02): this script reproduces the in-memory op
-- BIT-FOR-BIT — every Math.floor / Math.ceil happens at the identical point.
-- Lua 5.1 `number` is an IEEE-754 double (same as JS `number`); identical
-- integer ARGV + identical double ops ⇒ identical floored/ceiled integers.
--
-- KEYS[1] = rl:tb:<key>   (the namespaced key — NEVER concatenated into the body)
-- ARGV   = { now, capacity, refillPerInterval, intervalMs, cost }  (all integers)
-- Return = { allowed, remaining, resetMs, retryAfterMs }  (ALL integers)
--
-- Pitfall 1: Redis truncates a RETURNED Lua number toward zero, so every value
-- is floored/ceiled BEFORE the return. The only persisted float (`tokens`) is
-- stored as a %.17g string in a hash field — never returned, never stored bare.

local key = KEYS[1]
local now = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local refillPerInterval = tonumber(ARGV[3])
local intervalMs = tonumber(ARGV[4])
local cost = tonumber(ARGV[5])

-- (1) load state or init a FULL bucket at `now` (missing fields → defaults).
local data = redis.call('HMGET', key, 'tokens', 'lastRefill')
local tokens = tonumber(data[1]) or capacity
local lastRefill = tonumber(data[2]) or now

-- (2) lazy refill. Recompute `elapsed` from the integer `now` every call —
-- never accumulate fractional ms (Pitfall 3).
local elapsed = math.max(0, now - lastRefill)
local refilled = math.min(capacity, tokens + (elapsed / intervalMs) * refillPerInterval)

-- (3) decide — all-or-nothing (D-01). cost > capacity simply fails here.
local allowed = (cost <= refilled) and 1 or 0

-- (4) next token count — unchanged on reject (D-01: byte-identical).
local tokensAfter = (allowed == 1) and (refilled - cost) or refilled

-- (5) assemble the integer-ms tuple.
local remaining = math.floor(tokensAfter)                                       -- FLOOR (D-04)
local resetMs = math.ceil(((capacity - tokensAfter) / refillPerInterval) * intervalMs) -- CEIL (D-05)
local retryAfterMs = 0
if allowed == 0 then
  local need = math.max(0, cost - refilled)
  retryAfterMs = math.ceil((need / refillPerInterval) * intervalMs)             -- CEIL (D-03)
end

-- persist new state: `tokens` as a lossless %.17g string (Pitfall 1), lastRefill
-- always advances to `now`. Set TTL inside the script (STOR-03): time to refill
-- from empty to full; after that an absent key re-inits to a full bucket —
-- identical observable result, so expiry is safe. `+1` guards the ceil boundary.
redis.call('HSET', key, 'tokens', string.format('%.17g', tokensAfter), 'lastRefill', now)
local ttl = math.ceil((capacity / refillPerInterval) * intervalMs) + 1
redis.call('PEXPIRE', key, ttl)

return { allowed, remaining, resetMs, retryAfterMs }
