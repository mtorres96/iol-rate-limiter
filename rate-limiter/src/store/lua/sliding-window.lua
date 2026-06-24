-- Sliding Window Counter (rl_sw) — ATOMIC Redis port of
-- MemoryStore.slidingWindow() (src/store/memory.ts L104-170). numberOfKeys: 1.
--
-- Parity contract (TEST-02): the weighted estimate's FLOOR (D-13) and the 3-way
-- retryAfterMs branch (memory.ts L148-165) are reproduced VERBATIM. This is the
-- highest-drift-risk script — pinned by the Xu Ch.4 conformance anchor
-- (limit=7, prev=5, curr=3, 50% in → admit, remaining=1).
--
-- KEYS[1] = rl:sw:<key>
-- ARGV   = { now, limit, windowMs, cost }  (all integers)
-- Return = { allowed, remaining, resetMs, retryAfterMs }  (ALL integers)

local key = KEYS[1]
local now = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local windowMs = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local bucket = math.floor(now / windowMs)

-- (1) load + roll. same bucket → keep; bucket-1 → curr→prev, curr=0;
-- gap ≥2 (or missing) → prev=0, curr=0.
local data = redis.call('HMGET', key, 'bucket', 'curr', 'prev')
local storedBucket = tonumber(data[1])
local storedCurr = tonumber(data[2])
local storedPrev = tonumber(data[3])

local curr
local prev
if storedBucket == nil then
  curr = 0
  prev = 0
elseif storedBucket == bucket then
  curr = storedCurr
  prev = storedPrev
elseif storedBucket == bucket - 1 then
  prev = storedCurr
  curr = 0
else
  prev = 0
  curr = 0
end

-- (2) weighted estimate. overlapFraction = how much of the PREVIOUS window still
-- overlaps the rolling window: 1 at a fresh boundary, →0 as we move in.
local elapsedInCurrent = now - bucket * windowMs
local overlapFraction = (windowMs - elapsedInCurrent) / windowMs
local estimate = curr + prev * overlapFraction
local flooredEstimate = math.floor(estimate)                                    -- FLOOR (D-13)

-- (3) decide — all-or-nothing (D-01). cost > limit fails gracefully (D-02).
local allowed = (flooredEstimate + cost <= limit) and 1 or 0

-- (4) increment curr ONLY on admit (reject leaves counts byte-identical — D-01).
local currAfter = (allowed == 1) and (curr + cost) or curr

-- (5) assemble the integer-ms tuple.
local usedAfter = flooredEstimate + ((allowed == 1) and cost or 0)
local remaining = math.max(0, limit - usedAfter)                                -- integer counts (D-04)
local msToBoundary = (bucket + 1) * windowMs - now
local resetMs = math.ceil(msToBoundary)                                         -- CEIL (D-05)

-- retryAfterMs: reproduce the memory.ts 3-way branch (L148-165) verbatim.
local retryAfterMs
if allowed == 1 then
  retryAfterMs = 0
elseif curr + cost > limit then
  -- curr alone (ignoring all previous weight) already exceeds the limit —
  -- earliest possible relief is when this window rolls.
  retryAfterMs = math.ceil(msToBoundary)                                        -- CEIL (D-03)
else
  -- Need the previous-window contribution to decay by `overshoot` requests.
  -- prev decays linearly over windowMs; ms per one request of weight =
  -- windowMs / prev. Solve floor(curr + prev*frac') + cost <= limit.
  local overshoot = flooredEstimate + cost - limit                             -- > 0 here
  local msToDecayOne = (prev > 0) and (windowMs / prev) or msToBoundary
  retryAfterMs = math.min(
    math.ceil(overshoot * msToDecayOne),                                        -- CEIL (D-03)
    math.ceil(msToBoundary)
  )
end

-- persist new state; set TTL inside the script (STOR-03): both `prev` and `curr`
-- buckets must survive — the previous window stays relevant for up to 2×windowMs.
redis.call('HSET', key, 'bucket', bucket, 'curr', currAfter, 'prev', prev)
local ttl = 2 * windowMs + 1
redis.call('PEXPIRE', key, ttl)

return { allowed, remaining, resetMs, retryAfterMs }
