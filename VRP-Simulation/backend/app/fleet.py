def capacities(instance):
    return (
        [v.capacity for v in instance.fleet]
        if instance.fleet
        else [instance.capacity] * instance.vehicles
    )
