import type {
  ClaimPredicate,
  ClaimVerdict,
  PredicateResult,
} from '@/types/experiment';

const EPSILON = 1e-12;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Acklam inverse-normal approximation; sufficient for protocol confidence levels in (0.5, 0.9999). */
function inverseNormalCdf(probability: number): number {
  if (!(probability > 0 && probability < 1)) throw new Error('概率必须位于 (0, 1)');
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  const high = 1 - low;
  if (probability < low) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (probability > high) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = probability - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
    / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export function wilsonInterval(successes: number, total: number, confidenceLevel = 0.95): [number, number] {
  if (!Number.isInteger(successes) || !Number.isInteger(total) || total <= 0 || successes < 0 || successes > total) {
    throw new Error('Wilson 区间需要 0 <= successes <= total 的整数计数');
  }
  const z = inverseNormalCdf(0.5 + confidenceLevel / 2);
  const p = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total) / denominator;
  return [clamp(center - margin, 0, 1), clamp(center + margin, 0, 1)];
}

function logGamma(value: number): number {
  const coefficients = [
    676.5203681218851, -1259.1392167224028, 771.3234287776531,
    -176.6150291621406, 12.507343278686905, -0.13857109526572012,
    9.984369578019572e-6, 1.5056327351493116e-7,
  ];
  if (value < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  let x = 0.9999999999998099;
  const shifted = value - 1;
  coefficients.forEach((coefficient, index) => { x += coefficient / (shifted + index + 1); });
  const t = shifted + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(x);
}

function betaContinuedFraction(a: number, b: number, x: number): number {
  const maxIterations = 200;
  const fpMin = 1e-30;
  let qab = a + b;
  let qap = a + 1;
  let qam = a - 1;
  let c = 1;
  let d = 1 - qab * x / qap;
  if (Math.abs(d) < fpMin) d = fpMin;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= maxIterations; m += 1) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpMin) d = fpMin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpMin) c = fpMin;
    d = 1 / d;
    h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpMin) d = fpMin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpMin) c = fpMin;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 3e-12) break;
  }
  return h;
}

function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2)
    ? front * betaContinuedFraction(a, b, x) / a
    : 1 - front * betaContinuedFraction(b, a, 1 - x) / b;
}

function inverseRegularizedBeta(probability: number, a: number, b: number): number {
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const middle = (low + high) / 2;
    if (regularizedBeta(middle, a, b) < probability) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

export function clopperPearsonInterval(successes: number, total: number, confidenceLevel = 0.95): [number, number] {
  if (!Number.isInteger(successes) || !Number.isInteger(total) || total <= 0 || successes < 0 || successes > total) {
    throw new Error('Clopper-Pearson 区间需要有效整数计数');
  }
  const alpha = 1 - confidenceLevel;
  const lower = successes === 0 ? 0 : inverseRegularizedBeta(alpha / 2, successes, total - successes + 1);
  const upper = successes === total ? 1 : inverseRegularizedBeta(1 - alpha / 2, successes + 1, total - successes);
  return [lower, upper];
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 0x6d2b79f5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

export function seededBootstrapInterval(
  values: number[],
  estimator: (sample: number[]) => number,
  confidenceLevel = 0.95,
  samples = 2000,
  seed = 42,
): [number, number] {
  if (values.length === 0 || samples < 100) throw new Error('bootstrap 样本不足');
  const random = seededRandom(seed);
  const estimates: number[] = [];
  const maximumAttempts = samples * 10;
  for (let iteration = 0; iteration < maximumAttempts && estimates.length < samples; iteration += 1) {
    const resample = Array.from({ length: values.length }, () => values[Math.floor(random() * values.length)]);
    const estimate = estimator(resample);
    if (Number.isFinite(estimate)) estimates.push(estimate);
  }
  if (estimates.length < samples) throw new Error('bootstrap 有效重采样不足，当前数据无法稳定估计区间');
  estimates.sort((left, right) => left - right);
  const alpha = 1 - confidenceLevel;
  const lowerIndex = Math.floor((alpha / 2) * (estimates.length - 1));
  const upperIndex = Math.ceil((1 - alpha / 2) * (estimates.length - 1));
  return [estimates[lowerIndex], estimates[upperIndex]];
}

export function verdictForInterval(
  operator: ClaimPredicate['operator'],
  threshold: number,
  lowerBound: number,
  upperBound: number,
): ClaimVerdict {
  if (operator === 'gte') {
    if (lowerBound >= threshold - EPSILON) return 'pass';
    if (upperBound < threshold - EPSILON) return 'fail';
    return 'inconclusive';
  }
  if (upperBound <= threshold + EPSILON) return 'pass';
  if (lowerBound > threshold + EPSILON) return 'fail';
  return 'inconclusive';
}

export function combinePredicateVerdicts(results: PredicateResult[]): ClaimVerdict {
  if (results.length === 0) throw new Error('复合主张至少需要一个子主张');
  if (results.some(result => result.verdict === 'fail')) return 'fail';
  if (results.every(result => result.verdict === 'pass')) return 'pass';
  return 'inconclusive';
}
