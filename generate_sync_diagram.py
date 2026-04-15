import matplotlib.pyplot as plt
import numpy as np

# Set style and font that supports Chinese
plt.style.use('seaborn-v0_8-whitegrid')
plt.rcParams['font.sans-serif'] = ['WenQuanYi Micro Hei', 'SimHei', 'DejaVu Sans', 'Arial']
plt.rcParams['axes.unicode_minus'] = False

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(15, 6))

# Current Architecture
days_current = np.arange(1, 96)
data_vol_current = np.ones_like(days_current) * 100

ax1.fill_between(days_current, 0, data_vol_current, color='#e74c3c', alpha=0.6)
ax1.set_title('Current Architecture: Full Request (95 Days)', fontsize=14, pad=15)
ax1.set_xlabel('Historical Days', fontsize=12)
ax1.set_ylabel('Requested Data Volume (%)', fontsize=12)
ax1.set_xlim(1, 95)
ax1.set_ylim(0, 110)
ax1.text(45, 50, 'Huge single request volume\nProne to timeouts and 400 errors', ha='center', va='center', fontsize=11, 
         bbox=dict(facecolor='white', alpha=0.8, edgecolor='none', boxstyle='round,pad=1'))

# Proposed Architecture
days_proposed = np.arange(1, 96)
data_vol_proposed = np.zeros_like(days_proposed)

data_vol_proposed[0:7] = 100
data_vol_proposed[7:14] = 50
data_vol_proposed[14:30] = 20
data_vol_proposed[30:95] = 5

colors = ['#e74c3c', '#f39c12', '#3498db', '#34495e']
labels = ['Hot Data (1-7d)\nHigh Freq', 'Warm Data (8-14d)\nMed Freq', 'Cool Data (15-30d)\nLow Freq', 'Cold Data (31-95d)\nOn-Demand']

ax2.fill_between(days_proposed[0:7], 0, data_vol_proposed[0:7], color=colors[0], alpha=0.7, label=labels[0])
ax2.fill_between(days_proposed[7:14], 0, data_vol_proposed[7:14], color=colors[1], alpha=0.7, label=labels[1])
ax2.fill_between(days_proposed[14:30], 0, data_vol_proposed[14:30], color=colors[2], alpha=0.7, label=labels[2])
ax2.fill_between(days_proposed[30:95], 0, data_vol_proposed[30:95], color=colors[3], alpha=0.7, label=labels[3])

ax2.set_title('Optimized Architecture: Tiered by Attribution Window', fontsize=14, pad=15)
ax2.set_xlabel('Historical Days', fontsize=12)
ax2.set_xlim(1, 95)
ax2.set_ylim(0, 110)
ax2.legend(loc='upper right', fontsize=10)

ax2.annotate('Inside Window\n(Volatile)', xy=(7, 100), xytext=(15, 80),
            arrowprops=dict(facecolor='black', shrink=0.05, width=1.5, headwidth=8),
            fontsize=11)
ax2.annotate('Outside Window\n(Stable)', xy=(30, 20), xytext=(45, 40),
            arrowprops=dict(facecolor='black', shrink=0.05, width=1.5, headwidth=8),
            fontsize=11)

plt.tight_layout()
plt.savefig('/home/ubuntu/sync_architecture_comparison.png', dpi=300, bbox_inches='tight')
print("Chart generated successfully at /home/ubuntu/sync_architecture_comparison.png")
