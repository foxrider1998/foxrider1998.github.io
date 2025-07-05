#!/bin/bash

# Portfolio Deployment Script
# This script helps deploy the portfolio to GitHub Pages

echo "🚀 Portfolio Deployment Script"
echo "=============================="

# Check if git is installed
if ! command -v git &> /dev/null; then
    echo "❌ Git is not installed. Please install Git first."
    exit 1
fi

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo "📁 Initializing Git repository..."
    git init
    echo "✅ Git repository initialized"
fi

# Add all files
echo "📋 Adding files to Git..."
git add .

# Commit changes
echo "💾 Committing changes..."
read -p "Enter commit message (or press Enter for default): " commit_message
if [ -z "$commit_message" ]; then
    commit_message="Update portfolio - $(date '+%Y-%m-%d %H:%M:%S')"
fi
git commit -m "$commit_message"

# Check if remote origin exists
if ! git remote get-url origin > /dev/null 2>&1; then
    echo "🔗 Setting up GitHub remote..."
    read -p "Enter your GitHub username: " github_username
    read -p "Enter repository name (default: foxrider1998.github.io): " repo_name
    if [ -z "$repo_name" ]; then
        repo_name="foxrider1998.github.io"
    fi
    git remote add origin https://github.com/$github_username/$repo_name.git
    echo "✅ Remote origin set to: https://github.com/$github_username/$repo_name.git"
fi

# Set main branch
echo "🌿 Setting up main branch..."
git branch -M main

# Push to GitHub
echo "🚀 Pushing to GitHub..."
git push -u origin main

echo ""
echo "✅ Deployment completed!"
echo "📊 Your portfolio will be available at:"
echo "   https://$(git remote get-url origin | sed 's/https:\/\/github.com\///g' | sed 's/\.git//g' | cut -d'/' -f1).github.io"
echo ""
echo "🕐 Note: It may take a few minutes for GitHub Pages to update."
echo "💡 Make sure GitHub Pages is enabled in your repository settings."
