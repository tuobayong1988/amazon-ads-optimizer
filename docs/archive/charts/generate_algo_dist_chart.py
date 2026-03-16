
import matplotlib.pyplot as plt
import numpy as np
import matplotlib

# 设置中文字体
matplotlib.rcParams['font.sans-serif'] = ['SimHei']
matplotlib.rcParams['axes.unicode_minus'] = False

# 数据
labels = ['规则引擎', '护栏保护', '高级算法', '保守策略']
v272_dist = [75, 0, 15, 10]  # 修复前，护栏保护被错误计入规则引擎
v273_dist = [25, 45, 25, 5]  # 修复后预测分布

x = np.arange(len(labels))
width = 0.35

fig, ax = plt.subplots(figsize=(10, 6))

# 绘制柱状图
rects1 = ax.bar(x - width/2, v272_dist, width, label='修复前 (v272)', color='#F87171')
rects2 = ax.bar(x + width/2, v273_dist, width, label='修复后 (v273, 预测)', color='#34D399')

# 添加标签、标题和图例
ax.set_ylabel('算法决策占比 (%)')
ax.set_title('v273 修复前后算法分布对比 (预测)')
ax.set_xticks(x)
ax.set_xticklabels(labels)
ax.legend()

# 在柱状图上显示数值
ax.bar_label(rects1, padding=3)
ax.bar_label(rects2, padding=3)

fig.tight_layout()

# 保存图像
plt.savefig('/home/ubuntu/amazon-ads-optimizer/v273_algo_dist_chart.png', dpi=300)

print('Algorithm distribution chart saved to /home/ubuntu/amazon-ads-optimizer/v273_algo_dist_chart.png')
