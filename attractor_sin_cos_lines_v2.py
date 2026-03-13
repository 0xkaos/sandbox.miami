import os
import time
import torch
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.collections as mcoll

# Setup
device = 'cuda' if torch.cuda.is_available() else 'cpu'
print(f"Using device: {device}")

# Parameters for Line Rendering
n_particles = 2000      # Number of particles
n_iterations = 100      # Steps for the flow
dt = 0.05               # [HANDLE] Flow speed. Lower = smoother/shorter steps. Higher = more chaotic/jumpy.
R_VAL = 1.2             # Range

def generate_traces(c1=2.4, c2=1.6):
    # c1, c2 are the main [HANDLES] for shape geometry
    print(f"Generating flow traces (c1={c1}, c2={c2})...")
    # Initialize random points
    x = (torch.rand(n_particles, device=device) * 2.0 * R_VAL) - R_VAL
    y = (torch.rand(n_particles, device=device) * 2.0 * R_VAL) - R_VAL
    
    history_x = []
    history_y = []
    
    # We treat the map as a vector field: V = Map(P) - P
    # We integrate dP/dt = V(P)
    
    for i in range(n_iterations):
        history_x.append(x.cpu().numpy())
        history_y.append(y.cpu().numpy())
        
        # Calculate target position (Map)
        x2 = x * x
        y2 = y * y
        arg_x = x2 - y2 + c1
        arg_y = 2 * x * y + c2
        
        target_x = torch.sin(arg_x)
        target_y = torch.cos(arg_y)
        
        # Move a small step towards target
        # P_new = P + (Target - P) * dt
        x = x + (target_x - x) * dt
        y = y + (target_y - y) * dt
            
    # Stack to get (steps, particles)
    hx_np = np.stack(history_x)
    hy_np = np.stack(history_y)
    return hx_np, hy_np

def render_lines(hx, hy, filename):
    print(f"Rendering lines to {filename}...")
    
    plt.figure(figsize=(12, 12), facecolor='black')
    ax = plt.gca()
    ax.set_facecolor('black')
    ax.set_xlim(-R_VAL, R_VAL)
    ax.set_ylim(-R_VAL, R_VAL)
    
    # Prepare segments for LineCollection
    # hx, hy shape: (steps, particles)
    steps, particles = hx.shape
    
    # We want to draw segments from t to t+1
    # Create array of points: (steps, particles, 2)
    points = np.stack([hx, hy], axis=-1)
    
    # We need a list of segments. 
    # A segment is [[x1, y1], [x2, y2]]
    # We can vectorize this.
    # Segments shape: (steps-1, particles, 2, 2)
    # The first dimension is time, second is particle index.
    
    # p_start: points[:-1] -> shape (steps-1, particles, 2)
    # p_end:   points[1:]  -> shape (steps-1, particles, 2)
    p_start = points[:-1]
    p_end = points[1:]
    
    # Stack them: (steps-1, particles, 2, 2)
    segments_array = np.stack([p_start, p_end], axis=2)
    
    # Flatten to ( (steps-1)*particles, 2, 2 )
    all_segments = segments_array.reshape(-1, 2, 2)
    
    # Create color array based on time
    # We want the color to evolve over time (steps)
    # Create an array of time indices matching the flattened segments
    # The outer loop of reshape was 'steps-1', inner was 'particles'
    # So we repeat each time index 'particles' times
    t_indices = np.repeat(np.arange(steps-1), particles)
    
    # Create LineCollection
    # cmap options: 'viridis', 'plasma', 'inferno', 'magma', 'twilight'
    # Use a very thin line and low alpha to create a "hair" effect
    lc = mcoll.LineCollection(all_segments, cmap='viridis', linewidths=0.5, alpha=0.3)
    lc.set_array(t_indices) # Set the values for colormapping
    
    ax.add_collection(lc)
    plt.axis('off')
    
    plt.savefig(filename, dpi=150, bbox_inches='tight', pad_inches=0, facecolor='black')
    print(f"Saved to {filename}")
    plt.close()

if __name__ == "__main__":
    hx, hy = generate_traces()
    render_lines(hx, hy, "attractor_sin_cos_lines.png")
