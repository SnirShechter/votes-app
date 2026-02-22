interface BarChartProps {
  options: {
    label: string;
    count: number;
    percentage: number;
    highlighted?: boolean;
  }[];
  animated?: boolean;
}

export function BarChart({ options, animated = true }: BarChartProps) {
  return (
    <div className="space-y-3">
      {options.map((opt, i) => (
        <div key={i}>
          <div className="flex justify-between text-sm mb-1">
            <span className={opt.highlighted ? 'font-bold' : ''}>
              {opt.label}
            </span>
            <span>{opt.percentage}% ({opt.count})</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-6 dark:bg-gray-700">
            <div
              className={`h-6 rounded-full ${opt.highlighted ? 'bg-blue-600' : 'bg-blue-400'}`}
              style={{
                width: `${Math.max(opt.percentage, 1)}%`,
                transition: animated ? 'width 0.5s ease-out' : 'none',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
