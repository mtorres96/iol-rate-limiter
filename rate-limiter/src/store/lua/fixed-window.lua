-- Fixed Window Counter (rl_fw) — ATOMIC Redis port of
-- MemoryStore.fixedWindow() (src/store/memory.ts L180-204). numberOfKeys: 1.
--
-- Parity contract (TEST-02): a plain per-window counter; admit while
-- `count + cost <= limit`. The 2×-at-the-boundary burst is REQUIRED behavior
-- (Pitfall 4 / ALGO-03) — NO smoothing is added.
--
-- KEYS[1] = rl:fw:<key>
-- ARGV   = { now, limit, windowMs, cost }  (all integers)
-- Return = { allowed, remaining, resetMs, retryAfterMs }  (ALL integers)

local key = KEYS[1]
local now = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local windowMs = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local bucket = math.floor(now / windowMs)

-- (1) load state; start a fresh count whenever the bucket index moves.
local data = redis.call('HMGET', key, 'bucket', 'curr')
local storedBucket = tonumber(data[1])
local storedCurr = tonumber(data[2])
local count = (storedBucket ~= nil and storedBucket == bucket) and storedCurr or 0

-- (3) decide — all-or-nothing (D-01). cost > limit fails gracefully (D-02).
local allowed = (count + cost <= limit) and 1 or 0

-- (4) increment ONLY on admit (reject leaves count byte-identical — D-01).
local countAfter = (allowed == 1) and (count + cost) or count

-- (5) assemble the integer-ms tuple.
local remaining = math.max(0, limit - countAfter)                               -- integer counts (D-04)
local msToBoundary = (bucket + 1) * windowMs - now
local resetMs = math.ceil(msToBoundary)                                         -- CEIL (D-05)
local retryAfterMs = (allowed == 1) and 0 or math.ceil(msToBoundary)            -- CEIL (D-03)

-- persist new state (omit `prev` — unused by fixed window; matches store's prev:0).
-- set TTL inside the script (STOR-03): only `curr` matters; the uniform
-- 2×windowMs avoids an off-by-one at the boundary.
redis.call('HSET', key, 'bucket', bucket, 'curr', countAfter)
local ttl = 2 * windowMs + 1
redis.call('PEXPIRE', key, ttl)

return { allowed, remaining, resetMs, retryAfterMs }
