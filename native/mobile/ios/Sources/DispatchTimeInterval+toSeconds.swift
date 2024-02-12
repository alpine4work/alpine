import UIKit

extension DispatchTimeInterval {
    func toSeconds() -> Double {
        switch self {
        case .seconds(let value): return Double(value)
        case .milliseconds(let value): return Double(value) * 0.001
        case .microseconds(let value): return Double(value) * 0.000001
        case .nanoseconds(let value): return Double(value) * 0.000000001
        case .never: return Double.nan
        @unknown default: return Double.nan
        }
    }
}
