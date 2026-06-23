import streamlit as st
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from io import BytesIO
import os
import tempfile
from fpdf import FPDF

st.set_page_config(page_title="Leads Analytics Dashboard", layout="wide", page_icon="📈")

# =============================================================================
# Configuration & Constants
# =============================================================================
CONVERSION_STATUSES = ['In-transit', 'Joined']
FUNNEL_ORDER = ['Unknown', 'New Lead', 'Not Answered', 'Not Interested', 'Not Qualified', 'Follow up', 'Qualified', 'Offer diff role', 'Offer Accepted', 'Date of Joining Confirmed', 'In-transit', 'Joined', 'Dropout']

# Our World in Data Theme (Deep, rich categorical colors, excluding Brown from primary focus)
COLORS = ['#1a4773', '#1f9a8a', '#7f519f', '#4985cd', '#ec7966', '#cda470', '#69975e', '#c55f65', '#9b4d4a']
PRIMARY_COLOR = '#1a4773'  # Navy (Contacted but Not Converted)
SECONDARY_COLOR = '#b91c1c'  # Deep Red (Converted)
TERTIARY_COLOR = '#7f519f'  # Violet (Not Contacted)

def optimize_fig(fig):
    fig.update_layout(
        margin=dict(l=20, r=20, t=40, b=100),
        legend=dict(orientation="h", yanchor="top", y=-0.3, xanchor="center", x=0.5),
        plot_bgcolor='rgba(0,0,0,0)',
        paper_bgcolor='rgba(0,0,0,0)',
    )
    # Faint dashed gridlines to match the reference image aesthetic
    fig.update_xaxes(showgrid=True, gridwidth=1, gridcolor='#e5e7eb', griddash='dash')
    fig.update_yaxes(showgrid=True, gridwidth=1, gridcolor='#e5e7eb', griddash='dash')
    # Faint dashed gridlines to match the reference image aesthetic
    fig.update_xaxes(showgrid=True, gridwidth=1, gridcolor='#e5e7eb', griddash='dash')
    fig.update_yaxes(showgrid=True, gridwidth=1, gridcolor='#e5e7eb', griddash='dash')
    # Letting Plotly natively handle text contrast for all trace types automatically
    return fig

# =============================================================================
# Helper: Data Processing
# =============================================================================
@st.cache_data
def process_data(df):
    # Removed aggressive dropna to ensure Total Leads match uploaded CSV count exactly
    if 'Phone Number' in df.columns:
        df['Phone Number'] = df['Phone Number'].fillna('Unknown')
        # Deduplicate based on Phone Number, keeping the latest entry (assuming bottom of CSV is newest)
        df = df.drop_duplicates(subset=['Phone Number'], keep='last')
        
    if 'Status' in df.columns:
        df['Status'] = df['Status'].fillna('Unknown')
        
    # Ensure standard string formats for categoricals
    categorical_cols = ['Status', 'Call Disposition', 'Campaign Name', 'Account Owner Name', 'State', 'City', 'Qualification', 'Gender', 'Lead Source', 'Entry Channel', 'Rank']
    for col in categorical_cols:
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip().replace({'nan': 'Unknown', '': 'Unknown'})
            df[col] = df[col].fillna('Unknown')
            
    # Gender Standardization
    if 'Gender' in df.columns:
        def standardize_gender(g):
            g_clean = str(g).lower().strip()
            if g_clean in ['male', 'm']: return 'Male'
            if g_clean in ['female', 'f']: return 'Female'
            if g_clean == 'unknown': return 'Unknown'
            return 'Others'
        df['Gender'] = df['Gender'].apply(standardize_gender)
        
    # Deal Value (Robust cleanup)
    if 'Deal Value' in df.columns:
        df['Deal Value'] = df['Deal Value'].astype(str).str.replace(r'[^\d.]', '', regex=True)
        df['Deal Value'] = pd.to_numeric(df['Deal Value'], errors='coerce').fillna(0)
    else:
        df['Deal Value'] = 0
        
    # Days to Closure
    if 'Days to Closure' in df.columns:
        df['Days to Closure'] = pd.to_numeric(df['Days to Closure'], errors='coerce')
        
    # Age Bracket Generation
    if 'Age in Years' in df.columns:
        df['Age in Years'] = pd.to_numeric(df['Age in Years'], errors='coerce')
        bins = [0, 18, 21, 24, 27, 29, 200]
        labels = ['<18', '18-20', '21-23', '24-26', '27-28', '29+']
        df['Age Bracket'] = pd.cut(df['Age in Years'], bins=bins, labels=labels, right=False)
        df['Age Bracket'] = df['Age Bracket'].astype(str).replace({'nan': 'Unknown'})
        
    # Is Conversion flag
    df['Is Conversion'] = df['Status'].isin(CONVERSION_STATUSES)
    
    # Is Contacted flag (Exclude Unknown, New Lead, Not Answered)
    df['Is Contacted'] = ~df['Status'].isin(['Unknown', 'New Lead', 'Not Answered'])

    # Date handling
    if 'Creation Date' in df.columns:
        df['Creation Date'] = pd.to_datetime(df['Creation Date'], errors='coerce')
        df['Month'] = df['Creation Date'].dt.to_period('M').astype(str)
        df['ISO_Week'] = df['Creation Date'].dt.strftime('%Y-W%V')
        df['Day_of_Week'] = df['Creation Date'].dt.day_name()
        df['Hour_of_Day'] = df['Creation Date'].dt.hour
        df['Month'] = df['Month'].replace('NaT', 'Unknown Date')
        df['ISO_Week'] = df['ISO_Week'].replace('NaT', 'Unknown Date')
        df['Day_of_Week'] = df['Day_of_Week'].fillna('Unknown Day')
        df['Hour_of_Day'] = df['Hour_of_Day'].fillna(-1)
        
    return df

# =============================================================================
# UI Layout
# =============================================================================

st.title("📈 Leads Analytics Dashboard")
st.markdown("Upload your raw Leads CSV file to automatically generate Data Analyst-level insights.")

with st.sidebar:
    st.header("1. Upload Data")
    uploaded_file = st.file_uploader("Upload Leads CSV", type=["csv"])
    
    st.markdown("---")
    st.markdown("### Expected Columns:")
    st.markdown("- Status\n- Deal Value\n- Days to Closure\n- Call Disposition\n- Campaign Name\n- Account Owner Name\n- Creation Date")

if uploaded_file is not None:
    try:
        raw_df = pd.read_csv(uploaded_file)
        df = process_data(raw_df)
    except Exception as e:
        st.error(f"Error processing file: {e}")
        st.stop()
        
    # Store figures for PDF export
    figs = {}

    # =============================================================================
    # 1. KEY PERFORMANCE INDICATORS & VELOCITY
    # =============================================================================
    st.header("1. Key Performance Indicators & Velocity")
    
    total_leads = len(df)
    total_contacted = df['Is Contacted'].sum()
    total_converted = df['Is Conversion'].sum()
    conv_rate = (total_converted / total_contacted * 100) if total_contacted > 0 else 0
    avg_days = df[df['Is Conversion']]['Days to Closure'].mean()
    
    missing_cols = ['Name', 'Phone Number', 'Status', 'Campaign Name', 'Campaign ID', 'State', 'City', 'Gender', 'Age in Years', 'Qualification', 'Year of Passing', 'Years of Experience', 'Willing to Relocate', 'Rank']
    missing_cols_present = [c for c in missing_cols if c in df.columns]
    total_cells = len(df) * len(missing_cols_present)
    
    if total_cells > 0:
        missing_count = df[missing_cols_present].isna().sum().sum()
        unknown_count = (df[missing_cols_present] == 'Unknown').sum().sum()
        total_missing = missing_count + unknown_count
        missing_pct = (total_missing / total_cells) * 100
    else:
        total_missing = 0
        missing_pct = 0
    
    col1, col2, col3, col4, col5, col6 = st.columns(6)
    col1.metric("Total Leads", f"{total_leads:,}", help="Total number of unique leads (deduplicated by Phone Number).")
    col2.metric("Contacted Leads", f"{total_contacted:,}", help="Excludes 'New Lead', 'Not Answered', and 'Unknown' statuses.")
    col3.metric("Total Converted", f"{total_converted:,}", help="Total number of leads with Status 'In-transit' or 'Joined'.")
    col4.metric("Conversion Rate", f"{conv_rate:.1f}%", help="(Total Converted / Contacted Leads) * 100")
    col5.metric("Avg Days to Convert", f"{avg_days:.1f}" if pd.notnull(avg_days) else "N/A", help="Average Days to Closure for Converted Leads only.")
    col6.metric("Missing Data", f"{missing_pct:.1f}%", help=f"Percentage of missing or 'Unknown' data across {len(missing_cols_present)} key columns (Total Missing Fields: {total_missing:,}).")
    
    st.markdown("---")
    
    # =============================================================================
    # 2. FUNNEL ANALYSIS & DROP-OFF
    # =============================================================================
    st.header("2. Funnel & Drop-off Analysis", help="Analyzes the sequential drop-off of leads across the pipeline stages.")
    
    fc1, fc2 = st.columns(2)
    
    with fc1:
        st.subheader("Funnel Stages", help="Displays the exact volume of leads remaining at each stage. Sorted natively from top-of-funnel down to Dropouts.")
        if 'Status' in df.columns:
            funnel_counts = df['Status'].value_counts().reset_index()
            funnel_counts.columns = ['Stage', 'Count']
            
            # Sort ascending=True so the first stage appears at the top of the px.funnel
            funnel_counts['Order'] = funnel_counts['Stage'].map(lambda x: FUNNEL_ORDER.index(x) if x in FUNNEL_ORDER else 99)
            funnel_counts = funnel_counts.sort_values('Order', ascending=True).drop('Order', axis=1)
            fig_funnel = px.funnel(funnel_counts, x='Count', y='Stage', 
                                   title="Pipeline Snapshot", color='Stage', color_discrete_sequence=COLORS)
            fig_funnel.update_layout(showlegend=False)
            figs['funnel'] = optimize_fig(fig_funnel)
            st.plotly_chart(figs['funnel'], use_container_width=True)
            with st.expander("View Funnel Data"):
                st.dataframe(funnel_counts)
    
    with fc2:
        st.subheader("Drop-off Reasons (Leakage)", help="Shows the 'Call Disposition' for all leads that failed to convert. Excludes 'Unknown' reasons to focus on actionable insights.")
        if 'Call Disposition' in df.columns:
            dropoff_df = df[(~df['Is Conversion']) & (df['Status'] != 'New Lead')]
            dropoff_counts = dropoff_df['Call Disposition'].value_counts().reset_index()
            dropoff_counts.columns = ['Reason', 'Count']
            dropoff_counts = dropoff_counts[dropoff_counts['Reason'] != 'Unknown']
            dropoff_counts = dropoff_counts.sort_values('Count', ascending=False)
            fig_dropoff = px.pie(dropoff_counts.head(10), values='Count', names='Reason', hole=0.5, 
                                 title="Top 10 Drop-off Reasons", color_discrete_sequence=COLORS)
            # First trace: 'outside' text positioning for lines/arrows (Labels + Percent)
            fig_dropoff.update_traces(textinfo='label+percent', textposition='outside')
            
            # Second overlay trace: 'inside' text positioning for the raw counts
            import plotly.graph_objects as go
            base_trace = list(fig_dropoff.select_traces())[0]
            fig_dropoff.add_trace(go.Pie(
                labels=base_trace.labels,
                values=base_trace.values,
                hole=0.5,
                marker=base_trace.marker,
                textinfo='value',
                textposition='inside',
                showlegend=False,
                sort=False
            ))
            
            fig_dropoff.update_layout(showlegend=False)
            figs['dropoff'] = optimize_fig(fig_dropoff)
            st.plotly_chart(figs['dropoff'], use_container_width=True)
            with st.expander("View Drop-off Data"):
                st.dataframe(dropoff_counts)
                
    st.markdown("---")
    
    # =============================================================================
    # 3. TIME-SERIES TRENDS
    # =============================================================================
    st.header("3. Time-Series Trends", help="Evaluates lead generation and conversion velocity over time.")
    
    if 'Month' in df.columns and 'ISO_Week' in df.columns:
        tc1, tc2 = st.columns(2)
        
        with tc1:
            st.subheader("Monthly Converted", help="Compares total leads against successful conversions per month. Includes a secondary axis tracking the aggregate Conversion Rate %.")
            monthly = df.groupby('Month').agg(
                Leads=('Status', 'count'),
                Contacted=('Is Contacted', 'sum'),
                Converted=('Is Conversion', 'sum')
            ).reset_index()
            monthly['Conversion Rate (%)'] = (monthly['Converted'] / monthly['Contacted'] * 100).round(1)
            
            fig_month = go.Figure()
            fig_month.add_trace(go.Bar(x=monthly['Month'], y=monthly['Leads'], name='Total Leads', marker_color=PRIMARY_COLOR, text=monthly['Leads'], textposition='auto'))
            fig_month.add_trace(go.Bar(x=monthly['Month'], y=monthly['Converted'], name='Converted', marker_color=SECONDARY_COLOR, text=monthly['Converted'], textposition='auto'))
            fig_month.add_trace(go.Scatter(x=monthly['Month'], y=monthly['Conversion Rate (%)'], name='Conv Rate %', yaxis='y2', line=dict(color='red', width=2)))
            
            fig_month.update_layout(
                yaxis=dict(title='Count'),
                yaxis2=dict(title='Rate %', overlaying='y', side='right', range=[0, max(monthly['Conversion Rate (%)'].max()*1.2, 10)]),
                barmode='group'
            )
            figs['monthly'] = optimize_fig(fig_month)
            st.plotly_chart(figs['monthly'], use_container_width=True)
            
        with tc2:
            st.subheader("Weekly Converted", help="Tracks week-over-week momentum for both Lead generation and Conversions.")
            weekly = df.groupby('ISO_Week').agg(
                Leads=('Status', 'count'),
                Contacted=('Is Contacted', 'sum'),
                Converted=('Is Conversion', 'sum')
            ).reset_index()
            
            fig_week = px.line(weekly, x='ISO_Week', y=['Leads', 'Converted'], markers=True, title="Weekly Momentum", color_discrete_sequence=[PRIMARY_COLOR, SECONDARY_COLOR])
            fig_week.update_traces(mode="lines+markers+text", texttemplate="%{y}", textposition="top center")
            figs['weekly'] = optimize_fig(fig_week)
            st.plotly_chart(figs['weekly'], use_container_width=True)
            
        if 'Day_of_Week' in df.columns and 'Hour_of_Day' in df.columns:
            tc3, tc4 = st.columns([1, 2.5])
            with tc3:
                st.subheader("Lead Influx by Day", help="Aggregates total leads acquired based on the day of the week.")
                day_order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
                day_df = df.groupby('Day_of_Week').size().reset_index(name='Leads')
                day_df['Day_of_Week'] = pd.Categorical(day_df['Day_of_Week'], categories=day_order, ordered=True)
                day_df = day_df.sort_values('Day_of_Week')
                fig_day = px.bar(day_df, x='Day_of_Week', y='Leads', title="Leads by Day", color_discrete_sequence=[PRIMARY_COLOR], text_auto=True)
                figs['day'] = optimize_fig(fig_day)
                st.plotly_chart(figs['day'], use_container_width=True)
            with tc4:
                st.subheader("Lead Influx by Time", help="A density heatmap correlating the Day of Week with the Hour of Day to identify peak lead generation hours.")
                heat_df = df[(df['Day_of_Week'] != 'Unknown Day') & (df['Hour_of_Day'] != -1)].copy()
                heat_df = heat_df.groupby(['Day_of_Week', 'Hour_of_Day']).size().reset_index(name='Leads')
                
                day_order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
                heat_df['Day_of_Week'] = pd.Categorical(heat_df['Day_of_Week'], categories=day_order[::-1], ordered=True)
                
                all_hours = list(range(24))
                hour_labels = [f"{h%12 or 12} {'AM' if h < 12 else 'PM'}" for h in all_hours]
                heat_df['Hour_12'] = heat_df['Hour_of_Day'].apply(lambda h: f"{int(h)%12 or 12} {'AM' if int(h) < 12 else 'PM'}")
                
                fig_hour = px.density_heatmap(heat_df, x='Hour_12', y='Day_of_Week', z='Leads', histfunc='sum',
                                              title="Lead Influx Heatmap", color_continuous_scale='Teal', text_auto=True,
                                              category_orders={'Hour_12': hour_labels, 'Day_of_Week': day_order[::-1]})
                
                figs['hour'] = optimize_fig(fig_hour)
                st.plotly_chart(figs['hour'], use_container_width=True)
            
    st.markdown("---")
    
    # =============================================================================
    # 4. AGENT PERFORMANCE
    # =============================================================================
    st.header("4. Agent Performance", help="Ranks agents by lead volume. The 3-tier stacked bar visualizes their effectiveness in contacting leads and closing conversions. Width = Total Leads.")
    if 'Account Owner Name' in df.columns:
        agents = df.groupby('Account Owner Name').agg(
            Leads=('Status', 'count'),
            Contacted=('Is Contacted', 'sum'),
            Converted=('Is Conversion', 'sum'),
            Avg_Days_to_Convert=('Days to Closure', lambda x: x[df.loc[x.index, 'Is Conversion']].mean())
        ).reset_index()
        agents['Conversion Rate (%)'] = (agents['Converted'] / agents['Contacted'] * 100).round(1)
        agents = agents.sort_values('Leads', ascending=False)
        
        agents['Not Contacted'] = agents['Leads'] - agents['Contacted']
        agents['Contacted (Not Converted)'] = agents['Contacted'] - agents['Converted']
        agents_melt = agents.melt(id_vars=['Account Owner Name'], value_vars=['Not Contacted', 'Contacted (Not Converted)', 'Converted'], var_name='Type', value_name='Count')
        
        fig_agent = px.bar(agents_melt, x='Account Owner Name', y='Count', color='Type', 
                           title="Agent Performance (Funnel Breakdown)", text_auto=True, 
                           color_discrete_map={'Converted': SECONDARY_COLOR, 'Contacted (Not Converted)': PRIMARY_COLOR, 'Not Contacted': TERTIARY_COLOR})
        
        figs['agent'] = optimize_fig(fig_agent)
        st.plotly_chart(figs['agent'], use_container_width=True)
        
        with st.expander("View Agent Performance Table"):
            st.dataframe(agents.style.format({'Avg_Days_to_Convert': '{:.1f}', 'Conversion Rate (%)': '{:.1f}%'}))
            
    st.markdown("---")
    
    # =============================================================================
    # 5. DEMOGRAPHICS & GEO
    # =============================================================================
    st.header("5. Demographics", help="A 3-tier funnel breakdown of lead progression across key demographic cohorts.")
    st.markdown("Comparing Total Leads versus Converted across key demographic segments.")
    
    dc1, dc2, dc3 = st.columns(3)
    
    if 'Qualification' in df.columns:
        with dc1:
            qual = df.groupby('Qualification').agg(
                Leads=('Status', 'count'),
                Contacted=('Is Contacted', 'sum'),
                Converted=('Is Conversion', 'sum')
            ).reset_index()
            total_qual = qual['Leads'].sum()
            unknown_qual = qual[qual['Qualification'] == 'Unknown']['Leads'].sum() if 'Unknown' in qual['Qualification'].values else 0
            unknown_qual_pct = (unknown_qual / total_qual * 100) if total_qual > 0 else 0
            
            qual = qual[qual['Qualification'] != 'Unknown'].sort_values('Leads', ascending=False)
            qual['Not Contacted'] = qual['Leads'] - qual['Contacted']
            qual['Contacted (Not Converted)'] = qual['Contacted'] - qual['Converted']
            qual_plot = qual.head(10).melt(id_vars=['Qualification'], value_vars=['Not Contacted', 'Contacted (Not Converted)', 'Converted'], var_name='Type', value_name='Count')
            fig_qual = px.bar(qual_plot, x='Qualification', y='Count', color='Type', title="Top 10 By Qualification", color_discrete_map={'Converted': SECONDARY_COLOR, 'Contacted (Not Converted)': PRIMARY_COLOR, 'Not Contacted': TERTIARY_COLOR}, text_auto=True)
            figs['qual'] = optimize_fig(fig_qual)
            st.plotly_chart(figs['qual'], use_container_width=True)
            if unknown_qual > 0:
                st.caption(f"Ignored {unknown_qual} Unknown ({unknown_qual_pct:.1f}% of Total Data)")
            
    if 'State' in df.columns:
        with dc2:
            state = df.groupby('State').agg(
                Leads=('Status', 'count'),
                Contacted=('Is Contacted', 'sum'),
                Converted=('Is Conversion', 'sum')
            ).reset_index()
            total_state = state['Leads'].sum()
            unknown_state = state[state['State'] == 'Unknown']['Leads'].sum() if 'Unknown' in state['State'].values else 0
            unknown_state_pct = (unknown_state / total_state * 100) if total_state > 0 else 0
            
            state = state[state['State'] != 'Unknown'].sort_values('Leads', ascending=False)
            state['Not Contacted'] = state['Leads'] - state['Contacted']
            state['Contacted (Not Converted)'] = state['Contacted'] - state['Converted']
            state_plot = state.head(10).melt(id_vars=['State'], value_vars=['Not Contacted', 'Contacted (Not Converted)', 'Converted'], var_name='Type', value_name='Count')
            fig_state = px.bar(state_plot, x='State', y='Count', color='Type', title="Top 10 By State", color_discrete_map={'Converted': SECONDARY_COLOR, 'Contacted (Not Converted)': PRIMARY_COLOR, 'Not Contacted': TERTIARY_COLOR}, text_auto=True)
            figs['state'] = optimize_fig(fig_state)
            st.plotly_chart(figs['state'], use_container_width=True)
            if unknown_state > 0:
                st.caption(f"Ignored {unknown_state} Unknown ({unknown_state_pct:.1f}% of Total Data)")
            
    if 'Gender' in df.columns:
        with dc3:
            gender = df.groupby('Gender').agg(
                Leads=('Status', 'count'),
                Contacted=('Is Contacted', 'sum'),
                Converted=('Is Conversion', 'sum')
            ).reset_index()
            total_gender = gender['Leads'].sum()
            unknown_gender = gender[gender['Gender'] == 'Unknown']['Leads'].sum() if 'Unknown' in gender['Gender'].values else 0
            unknown_gender_pct = (unknown_gender / total_gender * 100) if total_gender > 0 else 0
            
            gender = gender[gender['Gender'] != 'Unknown'].sort_values('Leads', ascending=False)
            gender['Not Contacted'] = gender['Leads'] - gender['Contacted']
            gender['Contacted (Not Converted)'] = gender['Contacted'] - gender['Converted']
            gender_plot = gender.melt(id_vars=['Gender'], value_vars=['Not Contacted', 'Contacted (Not Converted)', 'Converted'], var_name='Type', value_name='Count')
            fig_gender = px.bar(gender_plot, x='Gender', y='Count', color='Type', title="By Gender", color_discrete_map={'Converted': SECONDARY_COLOR, 'Contacted (Not Converted)': PRIMARY_COLOR, 'Not Contacted': TERTIARY_COLOR}, text_auto=True)
            figs['gender'] = optimize_fig(fig_gender)
            st.plotly_chart(figs['gender'], use_container_width=True)
            if unknown_gender > 0:
                st.caption(f"Ignored {unknown_gender} Unknown ({unknown_gender_pct:.1f}% of Total Data)")

    dc4, dc5 = st.columns(2)
    if 'Rank' in df.columns:
        with dc4:
            rank = df.groupby('Rank').agg(
                Leads=('Status', 'count'),
                Contacted=('Is Contacted', 'sum'),
                Converted=('Is Conversion', 'sum')
            ).reset_index()
            total_rank = rank['Leads'].sum()
            unknown_rank = rank[rank['Rank'] == 'Unknown']['Leads'].sum() if 'Unknown' in rank['Rank'].values else 0
            unknown_rank_pct = (unknown_rank / total_rank * 100) if total_rank > 0 else 0
            
            rank = rank[rank['Rank'] != 'Unknown'].sort_values('Leads', ascending=False)
            rank['Not Contacted'] = rank['Leads'] - rank['Contacted']
            rank['Contacted (Not Converted)'] = rank['Contacted'] - rank['Converted']
            rank_plot = rank.head(10).melt(id_vars=['Rank'], value_vars=['Not Contacted', 'Contacted (Not Converted)', 'Converted'], var_name='Type', value_name='Count')
            fig_rank = px.bar(rank_plot, x='Rank', y='Count', color='Type', title="By Rank", color_discrete_map={'Converted': SECONDARY_COLOR, 'Contacted (Not Converted)': PRIMARY_COLOR, 'Not Contacted': TERTIARY_COLOR}, text_auto=True)
            figs['rank'] = optimize_fig(fig_rank)
            st.plotly_chart(figs['rank'], use_container_width=True)
            if unknown_rank > 0:
                st.caption(f"Ignored {unknown_rank} Unknown ({unknown_rank_pct:.1f}% of Total Data)")

    if 'Age Bracket' in df.columns:
        with dc5:
            age = df.groupby('Age Bracket').agg(
                Leads=('Status', 'count'),
                Contacted=('Is Contacted', 'sum'),
                Converted=('Is Conversion', 'sum')
            ).reset_index()
            total_age = age['Leads'].sum()
            unknown_age = age[age['Age Bracket'] == 'Unknown']['Leads'].sum() if 'Unknown' in age['Age Bracket'].values else 0
            unknown_age_pct = (unknown_age / total_age * 100) if total_age > 0 else 0
            
            age = age[age['Age Bracket'] != 'Unknown']
            bracket_order = ['<18', '18-20', '21-23', '24-26', '27-28', '29+']
            age['Age Bracket'] = pd.Categorical(age['Age Bracket'], categories=bracket_order, ordered=True)
            age = age.sort_values('Age Bracket')
            
            age['Not Contacted'] = age['Leads'] - age['Contacted']
            age['Contacted (Not Converted)'] = age['Contacted'] - age['Converted']
            age_plot = age.melt(id_vars=['Age Bracket'], value_vars=['Not Contacted', 'Contacted (Not Converted)', 'Converted'], var_name='Type', value_name='Count')
            fig_age = px.bar(age_plot, x='Age Bracket', y='Count', color='Type', title="By Age Bracket", color_discrete_map={'Converted': SECONDARY_COLOR, 'Contacted (Not Converted)': PRIMARY_COLOR, 'Not Contacted': TERTIARY_COLOR}, text_auto=True)
            figs['age'] = optimize_fig(fig_age)
            st.plotly_chart(figs['age'], use_container_width=True)
            if unknown_age > 0:
                st.caption(f"Ignored {unknown_age} Unknown ({unknown_age_pct:.1f}% of Total Data)")

    st.markdown("#### Converted Leads Breakdown", help="Treemaps and Pie charts visualizing the distribution of successful conversions across demographic segments. Excludes 'Unknown' values.")
    pc1, pc2, pc3 = st.columns(3)
    
    total_convs = df['Is Conversion'].sum()
    
    if 'Qualification' in df.columns:
        with pc1:
            conv_qual = qual[qual['Converted'] > 0]
            fig_qual_pie = px.treemap(conv_qual, path=[px.Constant("All"), 'Qualification'], values='Converted', title="Converted by Qualification", color_discrete_sequence=COLORS)
            fig_qual_pie.update_traces(textinfo='label+value+percent parent')
            figs['qual_pie'] = optimize_fig(fig_qual_pie)
            st.plotly_chart(figs['qual_pie'], use_container_width=True)
            
            unknown_qual_conv = df[(df['Qualification'] == 'Unknown') & (df['Is Conversion'])]['Is Conversion'].sum() if 'Unknown' in df['Qualification'].values else 0
            if unknown_qual_conv > 0 and total_convs > 0:
                st.caption(f"Ignored {unknown_qual_conv} Unknown converted ({(unknown_qual_conv/total_convs*100):.1f}% of Total Converted)")
            
    if 'State' in df.columns:
        with pc2:
            conv_state = state[state['Converted'] > 0]
            fig_state_pie = px.treemap(conv_state, path=[px.Constant("All"), 'State'], values='Converted', title="Converted by State", color_discrete_sequence=COLORS)
            fig_state_pie.update_traces(textinfo='label+value+percent parent')
            figs['state_pie'] = optimize_fig(fig_state_pie)
            st.plotly_chart(figs['state_pie'], use_container_width=True)
            
            unknown_state_conv = df[(df['State'] == 'Unknown') & (df['Is Conversion'])]['Is Conversion'].sum() if 'Unknown' in df['State'].values else 0
            if unknown_state_conv > 0 and total_convs > 0:
                st.caption(f"Ignored {unknown_state_conv} Unknown converted ({(unknown_state_conv/total_convs*100):.1f}% of Total Converted)")
            
    if 'Gender' in df.columns:
        with pc3:
            conv_gender = gender[gender['Converted'] > 0]
            fig_gender_pie = px.pie(conv_gender, values='Converted', names='Gender', title="Converted by Gender", color_discrete_sequence=COLORS)
            fig_gender_pie.update_traces(textinfo='percent+value')
            figs['gender_pie'] = optimize_fig(fig_gender_pie)
            st.plotly_chart(figs['gender_pie'], use_container_width=True)
            
            unknown_gender_conv = df[(df['Gender'] == 'Unknown') & (df['Is Conversion'])]['Is Conversion'].sum() if 'Unknown' in df['Gender'].values else 0
            if unknown_gender_conv > 0 and total_convs > 0:
                st.caption(f"Ignored {unknown_gender_conv} Unknown converted ({(unknown_gender_conv/total_convs*100):.1f}% of Total Converted)")

    pc4, pc5 = st.columns(2)
    if 'Rank' in df.columns:
        with pc4:
            conv_rank = rank[rank['Converted'] > 0]
            if not conv_rank.empty:
                fig_rank_pie = px.treemap(conv_rank, path=[px.Constant("All"), 'Rank'], values='Converted', title="Converted by Rank", color_discrete_sequence=COLORS)
                fig_rank_pie.update_traces(textinfo='label+value+percent parent')
                figs['rank_pie'] = optimize_fig(fig_rank_pie)
                st.plotly_chart(figs['rank_pie'], use_container_width=True)
                
                unknown_rank_conv = df[(df['Rank'] == 'Unknown') & (df['Is Conversion'])]['Is Conversion'].sum() if 'Unknown' in df['Rank'].values else 0
                if unknown_rank_conv > 0 and total_convs > 0:
                    st.caption(f"Ignored {unknown_rank_conv} Unknown converted ({(unknown_rank_conv/total_convs*100):.1f}% of Total Converted)")
                    
    if 'Age Bracket' in df.columns:
        with pc5:
            conv_age = age[age['Converted'] > 0]
            if not conv_age.empty:
                fig_age_pie = px.pie(conv_age, values='Converted', names='Age Bracket', title="Converted by Age Bracket", color_discrete_sequence=COLORS)
                fig_age_pie.update_traces(textinfo='percent+value')
                figs['age_pie'] = optimize_fig(fig_age_pie)
                st.plotly_chart(figs['age_pie'], use_container_width=True)
                
                unknown_age_conv = df[(df['Age Bracket'] == 'Unknown') & (df['Is Conversion'])]['Is Conversion'].sum() if 'Unknown' in df['Age Bracket'].values else 0
                if unknown_age_conv > 0 and total_convs > 0:
                    st.caption(f"Ignored {unknown_age_conv} Unknown converted ({(unknown_age_conv/total_convs*100):.1f}% of Total Converted)")

    st.markdown("---")
    
    # =============================================================================
    # 6. CAMPAIGN ANALYTICS
    # =============================================================================
    st.header("6. Campaign Analytics", help="Ranks top marketing campaigns by lead volume. The stacked bar breaks down leads into Not Contacted, Contacted (Not Converted), and Converted segments. Width = Total Leads.")
    if 'Campaign Name' in df.columns:
        campaigns = df.groupby('Campaign Name').agg(
            Leads=('Status', 'count'),
            Contacted=('Is Contacted', 'sum'),
            Converted=('Is Conversion', 'sum')
        ).reset_index()
        campaigns['Conversion Rate (%)'] = (campaigns['Converted'] / campaigns['Contacted'] * 100).round(1)
        total_camp = campaigns['Leads'].sum()
        unknown_camp = campaigns[campaigns['Campaign Name'] == 'Unknown']['Leads'].sum() if 'Unknown' in campaigns['Campaign Name'].values else 0
        unknown_camp_pct = (unknown_camp / total_camp * 100) if total_camp > 0 else 0
        
        campaigns = campaigns[campaigns['Campaign Name'] != 'Unknown'].sort_values('Leads', ascending=False)
        campaigns['Not Contacted'] = campaigns['Leads'] - campaigns['Contacted']
        campaigns['Contacted (Not Converted)'] = campaigns['Contacted'] - campaigns['Converted']
        
        camp_plot = campaigns.head(10).melt(id_vars=['Campaign Name'], value_vars=['Not Contacted', 'Contacted (Not Converted)', 'Converted'], var_name='Type', value_name='Count')
        
        fig_camp = px.bar(camp_plot, y='Campaign Name', x='Count', color='Type', orientation='h', 
                          title="Top 10 Campaigns (Funnel Breakdown)", 
                          color_discrete_map={'Converted': SECONDARY_COLOR, 'Contacted (Not Converted)': PRIMARY_COLOR, 'Not Contacted': TERTIARY_COLOR}, 
                          text_auto=True)
        fig_camp.update_layout(yaxis={'categoryorder': 'total ascending'})
        figs['campaign'] = optimize_fig(fig_camp)
        st.plotly_chart(figs['campaign'], use_container_width=True)
        if unknown_camp > 0:
            st.caption(f"Ignored {unknown_camp} Unknown leads ({unknown_camp_pct:.1f}% of Total Data)")
        
        with st.expander("View Full Campaign Table"):
            st.dataframe(campaigns.drop(columns=['Contacted (Not Converted)'], errors='ignore'))
            
        if 'Rank' in df.columns:
            st.markdown("---")
            st.subheader("Campaign vs Rank Distribution", help="A matrix showing the volume of leads generated by each campaign across different ranks.")
            
            camp_rank_df = df[(df['Campaign Name'] != 'Unknown') & (df['Rank'] != 'Unknown')]
            if not camp_rank_df.empty:
                fig_camp_rank = px.density_heatmap(
                    camp_rank_df, 
                    y='Campaign Name', 
                    x='Rank', 
                    title="Campaign by Rank Distribution",
                    text_auto=True, 
                    color_continuous_scale='Teal'
                )
                fig_camp_rank.update_layout(xaxis={'categoryorder': 'category ascending'}, yaxis={'categoryorder': 'total ascending'})
                figs['camp_rank_matrix'] = optimize_fig(fig_camp_rank)
                st.plotly_chart(figs['camp_rank_matrix'], use_container_width=True)
                
                with st.expander("View Pivot Table Data"):
                    pivot_display = pd.crosstab(camp_rank_df['Campaign Name'], camp_rank_df['Rank'], margins=True, margins_name="Grand Total")
                    try:
                        st.dataframe(pivot_display.style.background_gradient(cmap='GnBu', axis=None))
                    except Exception:
                        st.dataframe(pivot_display)

    # =============================================================================
    # Export Reports (Moved to Sidebar)
    # =============================================================================
    with st.sidebar:
        st.markdown("---")
        st.header("2. Export Reports")
        st.info("💡 **Tip:** Hover over any chart and click the camera icon to download it as a PNG.")
        
        with st.expander("Excel Data Export", expanded=True):
            @st.cache_data
            def generate_excel_report(dfs_dict):
                output = BytesIO()
                with pd.ExcelWriter(output, engine='openpyxl') as writer:
                    for sheet_name, d_f in dfs_dict.items():
                        if d_f is not None and not d_f.empty:
                            d_f.to_excel(writer, index=False, sheet_name=sheet_name)
                return output.getvalue()
            
            export_dfs = {}
            if 'Status' in df.columns and 'funnel_counts' in locals(): export_dfs['Funnel'] = funnel_counts
            if 'Call Disposition' in df.columns and 'dropoff_counts' in locals(): export_dfs['Drop-off'] = dropoff_counts
            if 'Month' in df.columns and 'monthly' in locals(): export_dfs['Monthly'] = monthly
            if 'ISO_Week' in df.columns and 'weekly' in locals(): export_dfs['Weekly'] = weekly
            if 'Account Owner Name' in df.columns and 'agents' in locals(): export_dfs['Agents'] = agents
            if 'Campaign Name' in df.columns and 'campaigns' in locals(): export_dfs['Campaigns'] = campaigns.drop(columns=['Contacted (Not Converted)'], errors='ignore')
            if 'Qualification' in df.columns and 'qual' in locals(): export_dfs['Qualifications'] = qual
            if 'State' in df.columns and 'state' in locals(): export_dfs['States'] = state
            if 'Gender' in df.columns and 'gender' in locals(): export_dfs['Gender'] = gender
            if 'Rank' in df.columns and 'rank' in locals(): export_dfs['Rank'] = rank
            if 'Age Bracket' in df.columns and 'age' in locals(): export_dfs['Age Bracket'] = age

            if export_dfs:
                excel_data = generate_excel_report(export_dfs)
                st.download_button(
                    label="📥 Download Excel Data",
                    data=excel_data,
                    file_name='leads_analytics_data.xlsx',
                    mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    use_container_width=True
                )
                
        with st.expander("PDF Visual Report Export", expanded=True):
            st.markdown("""
            **Export the entire dashboard exactly as you see it.**
            1. Click the button below to open the Print Dialog.
            2. Set Destination to **Save as PDF**.
            3. Under More Settings, enable **Background Graphics** (crucial for preserving the rich colors and dark bars).
            4. Click **Save**.
            """)
            
            # Inject CSS to hide sidebar and UI elements exclusively during printing
            st.markdown(
                """
                <style>
                @media print {
                    [data-testid="stSidebar"] { display: none !important; }
                    [data-testid="stHeader"] { display: none !important; }
                    header { display: none !important; }
                    footer { display: none !important; }
                    .block-container {
                        max-width: 100% !important;
                        width: 100% !important;
                        padding: 0 !important;
                        margin: 0 !important;
                    }
                    /* Force charts to fit exactly and not break across pages */
                    .stPlotlyChart {
                        width: 100% !important;
                        max-width: 100% !important;
                        page-break-inside: avoid !important;
                        break-inside: avoid !important;
                    }
                    /* Convert multi-column layouts into single vertical stacks for A4 printing */
                    [data-testid="column"] {
                        width: 100% !important;
                        flex: 1 1 100% !important;
                        min-width: 100% !important;
                        display: block !important;
                        page-break-inside: avoid !important;
                        break-inside: avoid !important;
                        margin-bottom: 20px !important;
                    }
                }
                </style>
                """,
                unsafe_allow_html=True
            )
            
            if st.button("🖨️ Export Full Dashboard to PDF", use_container_width=True):
                import streamlit.components.v1 as components
                components.html(
                    """
                    <script>
                        window.parent.print();
                    </script>
                    """,
                    height=0
                )

else:
    st.info("Awaiting CSV file upload in the sidebar.")
