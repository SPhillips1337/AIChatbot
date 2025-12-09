#!/bin/bash

# Start SSH service
service ssh start

# Start Apache in foreground
apache2-foreground
