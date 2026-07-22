import { Grid, Line } from '@react-three/drei';

export default function GridFloor() {
  return (
    <group>
      {/* 网格地面 */}
      <Grid
        args={[20, 20]}
        position={[0, 0, 0]}
        cellColor="#333355"
        sectionColor="#222244"
        cellSize={1}
        sectionSize={1}
        fadeDistance={25}
        fadeStrength={1}
      />

      {/* X 轴中心线（红色） */}
      <Line
        points={[[-10, 0, 0], [10, 0, 0]]}
        color="#ff4444"
        lineWidth={1}
        opacity={0.3}
        transparent
      />

      {/* Z 轴中心线（蓝色） */}
      <Line
        points={[[0, 0, -10], [0, 0, 10]]}
        color="#4444ff"
        lineWidth={1}
        opacity={0.3}
        transparent
      />

      {/* 半透明地面平面（用于射线检测） */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.01, 0]}
        visible={false}
      >
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial
          color="#1a1a2e"
          transparent
          opacity={0.1}
        />
      </mesh>
    </group>
  );
}
