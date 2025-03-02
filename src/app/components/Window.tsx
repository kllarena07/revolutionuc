"use client";

interface WindowProps {
  time: string;
  region: string;
  result: number;
}

const Window = ({ time, region, result }: WindowProps) => {
  return (
    <div className="p-2 bg-green-900 border border-green-700 rounded-lg flex justify-between items-center">
      <div>
        <p className="font-medium text-xs text-zinc-200">{time}</p>
        <p className="text-xs text-zinc-400">{region}</p>
      </div>
      <div className="text-green-400 font-medium text-xs">
        {result} gCO<sub>2</sub>/kWh
      </div>
    </div>
  );
};

export default Window;
