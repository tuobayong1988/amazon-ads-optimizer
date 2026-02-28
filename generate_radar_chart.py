'''
import matplotlib.pyplot as plt
import numpy as np
import matplotlib

# 设置中文字体
matplotlib.rcParams['font.sans-serif'] = ['SimHei']
matplotlib.rcParams['axes.unicode_minus'] = False

# 数据
labels = np.array(['算法层级分类准确性', '高级算法激活率', '优化执行频率', '系统活跃度可观测性', '前端统计真实性', '风险预警能力'])
num_vars = len(labels)

# v272 数据 (修复前)
v272_data = np.array([10, 15, 50, 0, 10, 50])

# v273 数据 (修复后)
v273_data = np.array([100, 30, 75, 100, 100, 50])

# 计算角度
angles = np.linspace(0, 2 * np.pi, num_vars, endpoint=False).tolist()

# 使图形闭合
v272_data = np.concatenate((v272_data, [v272_data[0]]))
v273_data = np.concatenate((v273_data, [v273_data[0]]))
angles += angles[:1]

# 绘图
fig, ax = plt.subplots(figsize=(8, 8), subplot_kw=dict(polar=True))

# 设置刻度标签
ax.set_thetagrids(np.degrees(angles[:-1]), labels)

# 绘制 v272 数据
ax.plot(angles, v272_data, 'o-', color='#F87171', linewidth=2, label='修复前 (v272)')
ax.fill(angles, v272_data, alpha=0.25, color='#F87171')

# 绘制 v273 数据
ax.plot(angles, v273_data, 'o-', color='#34D399', linewidth=2, label='修复后 (v273)')
ax.fill(angles, v273_data, alpha=0.25, color='#34D399')

# 设置范围和刻度
ax.set_ylim(0, 100)
ax.set_yticks([20, 40, 60, 80, 100])

# 添加标题和图例
plt.title('v273 修复前后系统能力雷达图', size=20, color='black', y=1.1)
ax.legend(loc='upper right', bbox_to_anchor=(1.3, 1.1))

# 保存图像
plt.savefig('/home/ubuntu/amazon-ads-optimizer/v273_radar_chart.png', dpi=300, bbox_inches='tight')

print('Radar chart saved to /home/ubuntu/amazon-ads-optimizer/v273_radar_chart.png')
'''
